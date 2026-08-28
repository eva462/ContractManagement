import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  AttachmentUploadMetaSchema,
  ErrorCode,
  PREVIEWABLE_MIMES,
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

    const file = await req.file()
    if (!file) throw badRequest(ErrorCode.VALIDATION_FAILED, '没有收到文件')

    // multipart 的字段值在 file.fields 里，取出附件分类
    const rawType = (file.fields?.attachmentType as { value?: string } | undefined)?.value
    const { attachmentType } = AttachmentUploadMetaSchema.parse({
      attachmentType: rawType ?? undefined,
    })

    const dto = await uploadAttachment(
      {
        contractId: id,
        fileName: file.filename,
        mimeType: file.mimetype,
        stream: file.file,
        attachmentType: attachmentType as AttachmentType,
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
