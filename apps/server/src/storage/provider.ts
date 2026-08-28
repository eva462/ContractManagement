import type { Readable } from 'node:stream'

/**
 * ★ 附件存储可替换边界
 *
 * 业务代码只拿到一个 storageKey，不知道文件躺在本地磁盘还是对象存储。
 * 换 S3 / MinIO / OSS 时写一个新实现，在 index.ts 里换掉即可。
 *
 * 注意：内容按 sha256 去重，同一份文件被多条附件记录引用时只存一份。
 * 因此删除 blob 前必须由调用方确认没有别的记录还在引用（见 attachment/service.ts）。
 */

export interface SaveResult {
  /** 存储键。本地实现是相对路径，S3 实现会是对象 key。 */
  key: string
  size: number
  sha256: string
  /** true = 内容已存在，这次没有真的写盘 */
  deduplicated: boolean
}

export interface StorageProvider {
  readonly name: string

  /** 保存一个流。返回的 sha256 由实现在写入过程中顺带算出，调用方不需要预先读一遍。 */
  save(stream: Readable): Promise<SaveResult>

  createReadStream(key: string): Promise<Readable>

  exists(key: string): Promise<boolean>

  /** 删除底层内容。调用前请先确认没有其他记录引用同一个 key。 */
  delete(key: string): Promise<void>
}
