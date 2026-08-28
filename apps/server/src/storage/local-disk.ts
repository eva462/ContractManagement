import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import type { SaveResult, StorageProvider } from './provider.js'

/**
 * 本地磁盘实现。内容寻址：文件按 sha256 分两层目录存放，
 *   ab/cd/abcd...（完整哈希）
 * 同一份文件重复上传只占一份磁盘。原始文件名不落在磁盘上 ——
 * 它存在数据库里，下载时再用，这样中文名、重名、路径穿越都不成问题。
 */
export class LocalDiskStorage implements StorageProvider {
  readonly name = 'local-disk'

  private readonly root: string
  private readonly tmpDir: string

  constructor(root: string) {
    this.root = resolve(root)
    this.tmpDir = join(this.root, '.tmp')
  }

  async init(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true })
  }

  private keyToPath(key: string): string {
    const full = resolve(this.root, key)
    // 存储键来自我们自己算的哈希，正常不会越界；这里是纵深防御，
    // 万一将来有人把用户输入接到 key 上，也不会读到 root 之外的文件。
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`非法的存储键: ${key}`)
    }
    return full
  }

  async save(stream: Readable): Promise<SaveResult> {
    await mkdir(this.tmpDir, { recursive: true })
    const tmpPath = join(this.tmpDir, randomBytes(16).toString('hex'))

    const hash = createHash('sha256')
    let size = 0

    try {
      // 一次流经既落盘又算哈希，不用把文件读两遍
      await pipeline(
        stream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            hash.update(chunk)
            size += chunk.length
            yield chunk
          }
        },
        createWriteStream(tmpPath),
      )
    } catch (err) {
      await rm(tmpPath, { force: true })
      throw err
    }

    const sha256 = hash.digest('hex')
    const key = `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`
    const finalPath = this.keyToPath(key)

    if (await this.exists(key)) {
      await rm(tmpPath, { force: true })
      return { key, size, sha256, deduplicated: true }
    }

    await mkdir(dirname(finalPath), { recursive: true })
    try {
      await rename(tmpPath, finalPath)
    } catch (err) {
      // 并发上传同一份文件时，另一个请求可能刚好抢先建好了
      await rm(tmpPath, { force: true })
      if (!(await this.exists(key))) throw err
      return { key, size, sha256, deduplicated: true }
    }

    return { key, size, sha256, deduplicated: false }
  }

  async createReadStream(key: string): Promise<Readable> {
    const path = this.keyToPath(key)
    await stat(path) // 不存在就在这里抛，而不是等流开始读才失败
    return createReadStream(path)
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.keyToPath(key))
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.keyToPath(key), { force: true })
  }
}
