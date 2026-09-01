import { extname } from 'node:path'
import type { Readable } from 'node:stream'
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_FILE_TYPES,
  ALLOWED_MIMES,
  ATTACHMENT_TYPE_LABEL,
  ErrorCode,
  PREVIEWABLE_MIMES,
  parseRedactions,
  type AttachmentDto,
  type AttachmentType,
  type ContractStatus,
  type RedactionRect,
} from '@contract/shared'
import { storage } from '../../context.js'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { AppError, badRequest, forbidden, notFound } from '../../http/errors.js'
import { writeAudit } from '../audit/service.js'
import { toUserBrief, userBriefSelect } from '../user/mapper.js'
import { canManageAttachments } from '../contract/permissions.js'
import type { ActingUser, RequestMeta } from '../../types.js'

const attachmentInclude = { uploadedBy: { select: userBriefSelect } } as const

interface AttachmentRow {
  id: string
  contractId: string
  fileName: string
  fileSize: number
  mimeType: string
  attachmentType: string
  uploadedAt: Date
  redactions?: unknown
  uploadedBy?: { id: string; username: string; displayName: string; role: string } | null
}

export function toAttachmentDto(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    contractId: row.contractId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    attachmentType: row.attachmentType as AttachmentType,
    previewable: (PREVIEWABLE_MIMES as readonly string[]).includes(row.mimeType),
    redactionCount: parseRedactions(row.redactions).length,
    uploadedBy: toUserBrief(row.uploadedBy),
    uploadedAt: row.uploadedAt.toISOString(),
  }
}

async function loadContract(contractId: string) {
  const contract = await db.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: { id: true, title: true, ownerId: true, status: true },
  })
  if (!contract) throw notFound(ErrorCode.CONTRACT_NOT_FOUND, '合同不存在或已被删除')
  return contract
}

/** 可见范围开关生效时，非管理员不能碰别人经办的合同附件。 */
function assertVisible(contract: { ownerId: string | null }, actor: ActingUser): void {
  if (env.contractVisibility === 'OWN' && actor.role === 'STAFF' && contract.ownerId !== actor.id) {
    throw forbidden('没有权限查看该合同的附件')
  }
}

export async function listAttachments(
  contractId: string,
  actor: ActingUser,
): Promise<AttachmentDto[]> {
  const contract = await loadContract(contractId)
  assertVisible(contract, actor)

  const rows = await db.contractAttachment.findMany({
    where: { contractId },
    include: attachmentInclude,
    orderBy: { uploadedAt: 'desc' },
  })
  return rows.map((r) => toAttachmentDto(r as AttachmentRow))
}

export interface UploadInput {
  contractId: string
  fileName: string
  mimeType: string
  stream: Readable
  attachmentType: AttachmentType
  /** 上传时的涂抹区域，供风险审查沿用 */
  redactions?: RedactionRect[]
}

export async function uploadAttachment(
  input: UploadInput,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<AttachmentDto> {
  const contract = await loadContract(input.contractId)
  assertVisible(contract, actor)

  const subject = { ownerId: contract.ownerId, status: contract.status as ContractStatus }
  if (!canManageAttachments(actor, subject)) {
    if (subject.status === 'CLOSED') {
      throw new AppError(ErrorCode.CONTRACT_READONLY, '合同已归档，不能再增删附件', 409)
    }
    throw forbidden('只能给自己经办的合同上传附件')
  }

  const count = await db.contractAttachment.count({ where: { contractId: input.contractId } })
  if (count >= env.maxAttachmentsPerContract) {
    throw badRequest(
      ErrorCode.ATTACHMENT_LIMIT_REACHED,
      `每份合同最多 ${env.maxAttachmentsPerContract} 个附件，请先删除一些再传`,
    )
  }

  // 扩展名和 MIME 都要在白名单里，任缺一个就拒。在读流之前就判掉，不白写盘。
  const ext = extname(input.fileName).toLowerCase()
  const allowedList = ALLOWED_FILE_TYPES.map((t) => t.label).join(' / ')
  if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIMES.includes(input.mimeType)) {
    throw badRequest(
      ErrorCode.ATTACHMENT_TYPE_REJECTED,
      `不支持的文件类型「${ext || input.mimeType}」。可上传：${allowedList}`,
    )
  }

  const saved = await storage.save(input.stream)

  if (saved.size === 0) {
    if (!saved.deduplicated) await storage.delete(saved.key).catch(() => {})
    throw badRequest(ErrorCode.ATTACHMENT_TYPE_REJECTED, '文件内容为空，无法上传')
  }

  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.contractAttachment.create({
        data: {
          contractId: input.contractId,
          fileName: input.fileName,
          fileSize: saved.size,
          mimeType: input.mimeType,
          sha256: saved.sha256,
          storageKey: saved.key,
          attachmentType: input.attachmentType,
          // 供风险审查沿用同一份涂抹决定
          redactions: input.redactions?.length ? (input.redactions as never) : undefined,
          uploadedById: actor.id,
        },
        include: attachmentInclude,
      })

      await writeAudit(tx, {
        entityType: 'CONTRACT',
        entityId: input.contractId,
        action: 'UPLOAD',
        userId: actor.id,
        userName: actor.displayName,
        // 涂抹了多少处要留痕 —— 这关系到「哪些内容被送去了第三方」，
        // 事后要能查。但**绝不记涂抹的内容本身**，那等于把敏感信息抄进日志。
        summary:
          `${actor.displayName} 上传了附件「${input.fileName}」（${ATTACHMENT_TYPE_LABEL[input.attachmentType]}）` +
          (input.redactions?.length ? `，涂抹了 ${input.redactions.length} 处` : ''),
        changes: {
          attachment: {
            before: null,
            after: { id: created.id, fileName: input.fileName, size: saved.size },
          },
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      })

      return toAttachmentDto(created as AttachmentRow)
    })
  } catch (err) {
    // 落库失败就把刚写的 blob 收掉；去重命中的不能删，别的记录还在用
    if (!saved.deduplicated) await storage.delete(saved.key).catch(() => {})
    throw err
  }
}

export async function loadAttachmentForRead(id: string, actor: ActingUser) {
  const row = await db.contractAttachment.findUnique({
    where: { id },
    include: { contract: { select: { id: true, ownerId: true, status: true, deletedAt: true } } },
  })
  if (!row || row.contract.deletedAt) {
    throw notFound(ErrorCode.ATTACHMENT_NOT_FOUND, '附件不存在')
  }
  assertVisible(row.contract, actor)
  return row
}

/** 下载留痕。合同是敏感资料，谁下过必须留下记录。 */
export async function recordDownload(
  attachment: { id: string; contractId: string; fileName: string },
  actor: ActingUser,
  meta: RequestMeta,
  via: 'download' | 'preview',
): Promise<void> {
  await db.$transaction(async (tx) => {
    await writeAudit(tx, {
      entityType: 'CONTRACT',
      entityId: attachment.contractId,
      action: 'DOWNLOAD',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} ${via === 'preview' ? '预览' : '下载'}了附件「${attachment.fileName}」`,
      changes: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
  })
}

export async function deleteAttachment(
  id: string,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<void> {
  const row = await loadAttachmentForRead(id, actor)
  const subject = {
    ownerId: row.contract.ownerId,
    status: row.contract.status as ContractStatus,
  }

  if (!canManageAttachments(actor, subject)) {
    if (subject.status === 'CLOSED') {
      throw new AppError(ErrorCode.CONTRACT_READONLY, '合同已归档，不能再增删附件', 409)
    }
    throw forbidden('只能删除自己经办的合同的附件')
  }

  await db.$transaction(async (tx) => {
    await tx.contractAttachment.delete({ where: { id } })
    await writeAudit(tx, {
      entityType: 'CONTRACT',
      entityId: row.contractId,
      action: 'DELETE',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} 删除了附件「${row.fileName}」`,
      changes: { attachment: { before: { id: row.id, fileName: row.fileName }, after: null } },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
  })

  // 内容是按 sha256 去重存的：只有没人再引用这份内容时才真删磁盘。
  // 放在事务提交之后 —— 万一删文件失败，最多留个孤儿文件，不会丢别人的附件。
  const stillReferenced = await db.contractAttachment.count({ where: { sha256: row.sha256 } })
  if (stillReferenced === 0) {
    await storage.delete(row.storageKey).catch(() => {})
  }
}
