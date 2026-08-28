import { z } from 'zod'
import { AUDIT_ACTION_VALUES, AUDIT_ENTITY_VALUES, type AuditAction, type AuditEntityType } from '../enums.js'

/** 单个字段的前后值。null 表示「空」，与「字段没变」不同 —— 没变的字段根本不会出现在 changes 里。 */
export interface AuditChange {
  before: unknown
  after: unknown
}

export interface AuditLogDto {
  id: string
  entityType: AuditEntityType
  entityId: string
  action: AuditAction
  userId: string | null
  /** 写入时的用户名快照。改显示名或停用账号都不影响历史记录。 */
  userName: string
  /** 人话摘要，时间线直接显示 */
  summary: string
  /** 字段级 diff，展开时显示。非 UPDATE 类操作可能为 null。 */
  changes: Record<string, AuditChange> | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export const AuditQuerySchema = z.object({
  entityType: z.enum(AUDIT_ENTITY_VALUES).optional(),
  entityId: z.string().max(64).optional(),
  action: z.enum(AUDIT_ACTION_VALUES).optional(),
  userId: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
