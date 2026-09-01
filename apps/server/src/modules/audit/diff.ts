import {
  CONTRACT_FIELD_LABEL,
  dateToDateString,
  formatContractFieldValue,
  type AuditChange,
  type Currency,
} from '@contract/shared'

/**
 * 把 Prisma 返回的值归一成「可比较 + 可 JSON 序列化」的形式。
 * Decimal 变字符串（避免 100.00 和 100.0 被当成不同值），Date 变 'YYYY-MM-DD'。
 */
export function normalizeForAudit(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) return dateToDateString(value)
  if (typeof value === 'object' && typeof (value as { toFixed?: unknown }).toFixed === 'function') {
    return (value as { toFixed: (n: number) => string }).toFixed(2)
  }
  return value
}

/**
 * 只产出真正变化的字段。没改的字段不会出现在结果里 ——
 * 这是「编辑只记录真正变化的字段」这条验收标准的落点。
 */
export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: readonly string[],
): Record<string, AuditChange> {
  const changes: Record<string, AuditChange> = {}

  for (const field of fields) {
    if (!(field in after)) continue // 局部更新时没提交的字段不参与比较

    const a = normalizeForAudit(after[field])
    const b = before ? normalizeForAudit(before[field]) : null

    if (b === a) continue
    changes[field] = { before: b, after: a }
  }

  return changes
}

export interface DescribeContext {
  currency?: Currency
  /** id → 显示名。写入时就把名字定死，之后改名不影响历史记录。 */
  names?: Record<string, string>
  /** 合同类型的 itemCode → 中文名。权威来源是数据库字典，要查好传进来。 */
  typeLabels?: Record<string, string>
  /** 最多在摘要里点名几个字段，超出的折成「等 N 项」 */
  maxFields?: number
}

/**
 * 字段变化 → 人话。摘要和 diff 展开用的是同一套 formatContractFieldValue，
 * 保证时间线上看到的和展开看到的一致。
 */
export function describeFieldChanges(
  changes: Record<string, AuditChange>,
  ctx: DescribeContext = {},
): string {
  const entries = Object.entries(changes)
  if (entries.length === 0) return ''

  const max = ctx.maxFields ?? 3
  const shown = entries.slice(0, max)
  const rest = entries.length - shown.length

  const parts = shown.map(([field, change]) => {
    const label = CONTRACT_FIELD_LABEL[field] ?? field
    const from = formatContractFieldValue(field, change.before, ctx)
    const to = formatContractFieldValue(field, change.after, ctx)
    return `${label}从 ${from} 修改为 ${to}`
  })

  const tail = rest > 0 ? `，等 ${entries.length} 项` : ''
  return `将${parts.join('，')}${tail}`
}

/** 创建时的摘要：列出填了内容的字段名，不铺开值，否则一条摘要能长到几百字。 */
export function describeCreatedFields(changes: Record<string, AuditChange>): string {
  const filled = Object.keys(changes).filter((f) => changes[f]?.after !== null)
  if (filled.length === 0) return ''
  const max = 5
  const labels = filled.slice(0, max).map((f) => CONTRACT_FIELD_LABEL[f] ?? f)
  const rest = filled.length - labels.length
  return rest > 0 ? `${labels.join('、')} 等 ${filled.length} 项` : labels.join('、')
}
