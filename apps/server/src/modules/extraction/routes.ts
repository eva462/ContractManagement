import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import {
  ErrorCode,
  describeRedactions,
  parseRedactions,
  type ExtractionResult,
} from '@contract/shared'
import { currentUser, requestMeta, requireAuth } from '../../auth/guards.js'
import { extractor } from '../../context.js'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { AppError, badRequest } from '../../http/errors.js'
import { documentLoaderConfig, loadDocument, renderPagePreviews } from '../../extraction/document-loader.js'
import { writeAudit } from '../audit/service.js'
import { listDictItems } from '../dict/service.js'

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

  /**
   * 页面预览。前端要在图上拉涂抹框，需要每页的图和尺寸。
   * 纯本地渲染，**不出网** —— 这一步不调任何模型。
   */
  app.post('/extraction/preview', async (req) => {
    const file = await req.file()
    if (!file) throw badRequest(ErrorCode.VALIDATION_FAILED, '没有收到文件')
    const buffer = await file.toBuffer()
    if (buffer.length === 0) throw badRequest(ErrorCode.VALIDATION_FAILED, '文件内容为空')

    return {
      data: renderPagePreviews({
        buffer,
        mimeType: file.mimetype,
        fileName: file.filename,
      }),
    }
  })

  app.post('/extraction/contract', async (req) => {
    const status = extractor.status()
    if (!status.available) {
      throw badRequest(ErrorCode.VALIDATION_FAILED, status.reason ?? '内容识别未启用')
    }

    // 手动遍历各个 part，而不是 req.file() + file.fields。
    // file.fields 只包含**文件之前**已解析的字段：浏览器 FormData 里
    // redactions 排在 file 后面，用 file.fields 读永远是 undefined，
    // 结果就是涂抹静默失效、内容照样出网。这个坑踩过一次，别改回去。
    let buffer: Buffer | null = null
    let fileName = ''
    let mimeType = ''
    const fields: Record<string, string> = {}

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        buffer = await part.toBuffer()
        fileName = part.filename
        mimeType = part.mimetype
      } else {
        fields[part.fieldname] = String(part.value)
      }
    }

    if (!buffer) throw badRequest(ErrorCode.VALIDATION_FAILED, '没有收到文件')
    if (buffer.length === 0) {
      throw badRequest(ErrorCode.VALIDATION_FAILED, '文件内容为空')
    }

    // 解析失败一律当「没涂」处理 —— 但那样内容就会原样出网，
    // 所以留痕里会写明这次到底涂没涂、涂了几处。
    const redactions = parseRedactions(fields.redactions)

    const user = currentUser(req)
    const meta = requestMeta(req)

    // 解析在本地完成，不出网。这一步失败（加密 PDF、损坏文件、页数超限）
    // 会直接抛出带中文说明的 AppError。
    const doc = loadDocument({
      buffer,
      mimeType,
      fileName,
      redactions,
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

    // 合同类型不再是封闭枚举，schema 拦不住模型编造的值 —— 这里按字典核一遍，
    // 不是有效的启用项就丢掉，留空让人自己选。宁可少填，不可填错。
    const extractedType = result.fields.contractType?.value
    if (typeof extractedType === 'string') {
      const valid = await listDictItems('CONTRACT_TYPE', false)
      if (!valid.some((i) => i.itemCode === extractedType)) {
        delete result.fields.contractType
        result.meta.fieldCount = Object.keys(result.fields).length
      }
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
          `${user.displayName} 对文件「${fileName}」执行了内容识别` +
          `（${result.meta.model}，${result.meta.pageCount} 页` +
          `${result.meta.mode === 'vision' ? `／${result.meta.imageCount} 张切图` : '／文本层'}，` +
          `耗时 ${(result.meta.elapsedMs / 1000).toFixed(1)} 秒，识别出 ${result.meta.fieldCount} 个字段，${describeRedactions(redactions)}）`,
        changes: {
          extraction: {
            before: null,
            after: {
              fileName,
              sha256: createHash('sha256').update(buffer).digest('hex'),
              bytes: buffer.length,
              // 只记涂了几处、哪几页 —— 记下被涂的内容本身就等于没涂
              redactionCount: redactions.length,
              redactedPages: [...new Set(redactions.map((r) => r.page + 1))].sort((a, b) => a - b),
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
