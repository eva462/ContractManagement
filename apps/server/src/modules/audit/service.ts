import type {
  AuditAction,
  AuditChange,
  AuditEntityType,
  AuditLogDto,
} from '@contract/shared'
import type { Tx } from '../../db.js'

export interface AuditEntry {
  entityType: AuditEntityType
  entityId: string
  action: AuditAction
  /** 系统自身发起的操作传 null */
  userId: string | null
  /** 写入时的用户名快照。系统操作传「系统」。 */
  userName: string
  /** 人话摘要，时间线直接显示，含操作人姓名 */
  summary: string
  changes?: Record<string, AuditChange> | null
  ip?: string | null
  userAgent?: string | null
}

/**
 * ⚠️ 只接受事务客户端 Tx，不接受 PrismaClient。
 *
 * 这是刻意的：审计日志必须和业务写入在同一个事务里提交。
 * 业务成功但日志丢了，等于没有审计。用类型把这条铁律焊死，
 * 而不是靠开发者记得。
 */
export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      userId: entry.userId,
      userName: entry.userName,
      summary: entry.summary,
      changes:
        entry.changes && Object.keys(entry.changes).length > 0
          ? (entry.changes as object)
          : undefined,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    },
  })
}

type AuditRow = {
  id: string
  entityType: string
  entityId: string
  action: string
  userId: string | null
  userName: string
  summary: string
  changes: unknown
  ip: string | null
  userAgent: string | null
  createdAt: Date
}

export function toAuditDto(row: AuditRow): AuditLogDto {
  return {
    id: row.id,
    entityType: row.entityType as AuditEntityType,
    entityId: row.entityId,
    action: row.action as AuditAction,
    userId: row.userId,
    userName: row.userName,
    summary: row.summary,
    changes: (row.changes as Record<string, AuditChange> | null) ?? null,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 注意这里没有 updateAudit / deleteAudit，将来也不要加。
 * 数据库层另有触发器禁止对 audit_logs 执行 UPDATE / DELETE。
 */
