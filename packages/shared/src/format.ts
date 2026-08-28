import {
  AMOUNT_TYPE_LABEL,
  ATTACHMENT_TYPE_LABEL,
  CONTRACT_STATUS_LABEL,
  CONTRACT_TYPE_LABEL,
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
  EXPIRING_SOON_DAYS,
  type AmountType,
  type AttachmentType,
  type ContractStatus,
  type ContractType,
  type Currency,
  type ExpiryState,
} from './enums.js'

/* ── 日期 ──────────────────────────────────────────────────────────── */

/**
 * 全系统日期一律用 'YYYY-MM-DD' 字符串在网络上传输，只在数据库边界转成 Date。
 * 这样不用处理时区，也不会出现「存进去 12-31，读出来 12-30」这类经典 bug。
 */
export type DateString = string

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateString(v: unknown): v is DateString {
  return typeof v === 'string' && DATE_RE.test(v)
}

/** 'YYYY-MM-DD' → Date（UTC 零点）。仅在写库前调用。 */
export function dateStringToDate(s: DateString): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

/** Date → 'YYYY-MM-DD'（按 UTC 取，配合上面的写入方式往返无损）。 */
export function dateToDateString(d: Date | string | null | undefined): DateString | null {
  if (!d) return null
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

/** 本地时区的今天。派生到期状态用它，让每个人看到的是自己日历上的今天。 */
export function todayString(): DateString {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 两个日期字符串相差多少天（b - a）。 */
export function daysBetween(a: DateString, b: DateString): number {
  const ms = dateStringToDate(b).getTime() - dateStringToDate(a).getTime()
  return Math.round(ms / 86_400_000)
}

/* ── 到期派生态 ─────────────────────────────────────────────────────── */

/**
 * 「已到期」不是存储状态，每次读取时算出来。
 * 只有履行中的合同才谈得上到期，草稿/已终止/已归档一律不显示到期标记。
 */
export function computeExpiryState(
  c: { status: ContractStatus; isPerpetual: boolean; expiryDate: DateString | null },
  today: DateString = todayString(),
): ExpiryState {
  if (c.status !== 'ACTIVE') return 'NONE'
  if (c.isPerpetual) return 'PERPETUAL'
  if (!c.expiryDate) return 'NONE'
  const remaining = daysBetween(today, c.expiryDate)
  if (remaining < 0) return 'EXPIRED'
  if (remaining <= EXPIRING_SOON_DAYS) return 'EXPIRING'
  return 'NORMAL'
}

/* ── 金额 ──────────────────────────────────────────────────────────── */

/**
 * 金额全程用字符串传输，避免 JSON 里的浮点误差 —— Prisma Decimal 也接受字符串。
 * 千分位 + 固定两位小数 + 币种符号。
 */
export function formatAmount(
  amount: string | number | null | undefined,
  currency: Currency = 'CNY',
): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return '—'
  const body = n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${CURRENCY_SYMBOL[currency] ?? ''}${body}`
}

/* ── 文件大小 ───────────────────────────────────────────────────────── */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* ── 字段值 → 人话 ──────────────────────────────────────────────────── */

export interface FieldFormatContext {
  currency?: Currency
  /** 把 ownerId 之类的 id 翻成显示名。审计摘要在写入时就把名字定死，之后改名不影响历史。 */
  names?: Record<string, string>
}

/**
 * 审计摘要（服务端写入时生成）和留痕 diff 展示（前端）共用同一套渲染，
 * 保证「时间线上看到的」和「展开 diff 看到的」是一致的。
 */
export function formatContractFieldValue(
  field: string,
  value: unknown,
  ctx: FieldFormatContext = {},
): string {
  if (value === null || value === undefined || value === '') return '空'

  switch (field) {
    case 'amount':
      return formatAmount(value as string, ctx.currency ?? 'CNY')
    case 'currency':
      return CURRENCY_LABEL[value as Currency] ?? String(value)
    case 'amountType':
      return AMOUNT_TYPE_LABEL[value as AmountType] ?? String(value)
    case 'contractType':
      return CONTRACT_TYPE_LABEL[value as ContractType] ?? String(value)
    case 'status':
      return CONTRACT_STATUS_LABEL[value as ContractStatus] ?? String(value)
    case 'attachmentType':
      return ATTACHMENT_TYPE_LABEL[value as AttachmentType] ?? String(value)
    case 'ownerId':
      return ctx.names?.[String(value)] ?? String(value)
    case 'isPerpetual':
      return value ? '是' : '否'
    case 'signDate':
    case 'effectiveDate':
    case 'expiryDate':
    case 'terminatedAt':
      return dateToDateString(value as string) ?? String(value)
    default:
      return String(value)
  }
}

export function fieldLabel(field: string, labels: Record<string, string>): string {
  return labels[field] ?? field
}
