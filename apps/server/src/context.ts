import { LocalPasswordAuthProvider } from './auth/local.js'
import type { AuthProvider } from './auth/provider.js'
import { db } from './db.js'
import type { FieldExtractor } from './extraction/provider.js'
import { resolveExtractor } from './extraction/providers.js'
import { env } from './env.js'
import { LocalDiskStorage } from './storage/local-disk.js'
import type { StorageProvider } from './storage/provider.js'

/**
 * ★ 可替换实现的唯一装配点。
 *
 * 路由和服务层只 import 这里导出的 auth / storage / extractor，永远不 import 具体实现类。
 * 要换成 OIDC 认证、S3 存储或别家识别服务，只改这个文件里的几行 new，其余代码一行不动。
 */

export const auth: AuthProvider = new LocalPasswordAuthProvider(db)

const localStorage = new LocalDiskStorage(env.uploadDir)
export const storage: StorageProvider = localStorage

/**
 * 字段识别。按 EXTRACTION_PROVIDER 选一家（deepseek / qwen），留空则自动挑一个
 * 配了 key 的。一个 key 都没配时装 NullExtractor —— 接口照常存在，只是
 * available:false，前端据此隐藏识别入口，系统其余部分完全不受影响。
 */
export const extractor: FieldExtractor = resolveExtractor()

/** 启动时做一次准备工作（本地实现是建目录；对象存储实现里可能是校验桶是否存在）。 */
export async function initInfrastructure(): Promise<void> {
  if (env.storageDriver !== 'local') {
    throw new Error(
      `暂不支持 STORAGE_DRIVER=${env.storageDriver}。当前阶段只实现了本地磁盘存储。`,
    )
  }
  await localStorage.init()
}
