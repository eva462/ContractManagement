import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  AttachmentUploadMetaSchema,
  ErrorCode,
  PREVIEWABLE_MIMES,
  parseRedactions,
  type AttachmentType,
} from '@contract/shared'
import { currentUser, requestMeta, requireAuth } from '../../auth/guards.js'
import { storage } from '../../context.js'
import { badRequest } from '../../http/errors.js'
import { actorOf } from '../../types.js'
import {
  deleteAttachment,
  listAttachments,
  loadAttachmentForRead,
  recordDownload,
  uploadAttachment,
} from './service.js'

/**
 * 中文文件名要按 RFC 5987 编码，否则浏览器存下来是乱码。
 * filename= 留一个 ASCII 兜底给老浏览器，filename*= 才是真正生效的那个。
 */
function contentDisposition(disposition: 'attachment' | 'inline', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

async function streamAttachment(
  reply: FastifyReply,
  row: { storageKey: string; mimeType: string; fileName: string; fileSize: number },
  disposition: 'attachment' | 'inline',
): Promise<void> {
  const stream = await storage.createReadStream(row.storageKey)
  reply
    .header('Content-Type', row.mimeType)
    .header('Content-Length', String(row.fileSize))
    .header('Content-Disposition', contentDisposition(disposition, row.fileName))
    // 附件是敏感内容，别让中间层缓存
    .header('Cache-Control', 'private, no-store')
  return reply.send(stream)
}

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/contracts/:id/attachments', async (req) => {
    const { id } = req.params as { id: string }
    return { data: await listAttachments(id, actorOf(currentUser(req))) }
  })

  app.post('/contracts/:id/attachments', async (req, reply) => {
    const { id } = req.params as { id: string }

    // 遍历各个 part 而不是 req.file() + file.fields：后者只含**文件之前**
    // 已解析的字段，字段排在文件后面就永远读不到。踩过一次（涂抹静默失效）。
    let buffer: Buffer | null = null
    let fileName = ''
    let mimeType = ''
    const fields: Record<string, string> = {}

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        // 先读成 buffer 再交给存储层。附件上限 50MB，内存扛得住，
        // 换来的是「字段和文件的先后顺序无所谓」。
        buffer = await part.toBuffer()
        fileName = part.filename
        mimeType = part.mimetype
      } else {
        fields[part.fieldname] = String(part.value)
      }
    }

    if (!buffer) throw badRequest(ErrorCode.VALIDATION_FAILED, '没有收到文件')

    const { attachmentType } = AttachmentUploadMetaSchema.parse({
      attachmentType: fields.attachmentType || undefined,
    })

    const dto = await uploadAttachment(
      {
        contractId: id,
        fileName,
        mimeType,
        stream: Readable.from(buffer),
        attachmentType: attachmentType as AttachmentType,
        // 这份文件上传时涂抹了哪些区域。**风险审查会沿用它** ——
        // 存档的是完整原件，但送去 AI 审查时不该把涂掉的内容又发一遍。
        redactions: parseRedactions(fields.redactions),
      },
      actorOf(currentUser(req)),
      requestMeta(req),
    )

    reply.code(201)
    return { data: dto }
  })

  app.get('/attachments/:id', async (req) => {
    const { id } = req.params as { id: string }
    const row = await loadAttachmentForRead(id, actorOf(currentUser(req)))
    const { toAttachmentDto } = await import('./service.js')
    return { data: toAttachmentDto(row) }
  })

  app.get('/attachments/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string }
    const actor = actorOf(currentUser(req))
    const row = await loadAttachmentForRead(id, actor)

    await recordDownload(row, actor, requestMeta(req), 'download')
    return streamAttachment(reply, row, 'attachment')
  })

  app.get('/attachments/:id/preview', async (req, reply) => {
    const { id } = req.params as { id: string }
    const actor = actorOf(currentUser(req))
    const row = await loadAttachmentForRead(id, actor)

    if (!(PREVIEWABLE_MIMES as readonly string[]).includes(row.mimeType)) {
      throw badRequest(ErrorCode.ATTACHMENT_TYPE_REJECTED, '该类型不支持在线预览，请下载后查看')
    }

    // PDF 阅读器会发很多 Range 请求。只在首次完整请求时留痕，
    // 否则一次预览能刷出几十条记录，把真正的操作淹掉。
    if (!req.headers.range) {
      await recordDownload(row, actor, requestMeta(req), 'preview')
    }
    return streamAttachment(reply, row, 'inline')
  })

  app.delete('/attachments/:id', async (req) => {
    const { id } = req.params as { id: string }
    await deleteAttachment(id, actorOf(currentUser(req)), requestMeta(req))
    return { data: { ok: true } }
  })
}
