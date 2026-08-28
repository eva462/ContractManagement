import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { ErrorCode, type ExtractionResult } from '@contract/shared'
import { currentUser, requestMeta, requireAuth } from '../../auth/guards.js'
import { extractor } from '../../context.js'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { AppError, badRequest } from '../../http/errors.js'
import { documentLoaderConfig, loadDocument } from '../../extraction/document-loader.js'
import { writeAudit } from '../audit/service.js'

export async function extractionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /** 前端据此决定要不要显示识别入口。没配 key 时 available:false。 */
  app.get('/extraction/status', async () => ({
    data: {
      ...extractor.status(),
      supportedMimes: documentLoaderConfig.supportedMimes,
      maxPages: documentLoaderConfig.maxPages,
    },
  }))

  app.post('/extraction/contract', async (req) => {
    const status = extractor.status()
    if (!status.available) {
      throw badRequest(ErrorCode.VALIDATION_FAILED, status.reason ?? '内容识别未启用')
    }

    const file = await req.file()
    if (!file) throw badRequest(ErrorCode.VALIDATION_FAILED, '没有收到文件')

    const buffer = await file.toBuffer()
    if (buffer.length === 0) {
      throw badRequest(ErrorCode.VALIDATION_FAILED, '文件内容为空')
    }

    const user = currentUser(req)
    const meta = requestMeta(req)

    // 解析在本地完成，不出网。这一步失败（加密 PDF、损坏文件、页数超限）
    // 会直接抛出带中文说明的 AppError。
    const doc = loadDocument({
      buffer,
      mimeType: file.mimetype,
      fileName: file.filename,
    })

    let result: ExtractionResult
    try {
      result = await extractor.extract(doc)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const aborted = detail.includes('abort') || detail.includes('timeout')
      throw new AppError(
        ErrorCode.INTERNAL,
        aborted
          ? `识别超时（超过 ${Math.round(env.extractionTimeoutMs / 1000)} 秒），请重试或手工录入`
          : `识别失败：${detail}`,
        502,
      )
    }

    // 识别是「把合同原件发到外部服务」的动作，必须留下记录 —— 谁、什么时候、
    // 把哪个文件送了出去。此时合同还不存在，所以挂在用户实体上。
    // 刻意只记文件名和哈希，不记合同全文（太长且敏感）。
    await db.$transaction(async (tx) => {
      await writeAudit(tx, {
        entityType: 'USER',
        entityId: user.id,
        action: 'EXTRACT',
        userId: user.id,
        userName: user.displayName,
        summary:
          `${user.displayName} 对文件「${file.filename}」执行了内容识别` +
          `（${result.meta.model}，${result.meta.pageCount} 页` +
          `${result.meta.mode === 'vision' ? `／${result.meta.imageCount} 张切图` : '／文本层'}，` +
          `耗时 ${(result.meta.elapsedMs / 1000).toFixed(1)} 秒，识别出 ${result.meta.fieldCount} 个字段）`,
        changes: {
          extraction: {
            before: null,
            after: {
              fileName: file.filename,
              sha256: createHash('sha256').update(buffer).digest('hex'),
              bytes: buffer.length,
              ...result.meta,
            },
          },
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
    })

    return { data: result }
  })
}
