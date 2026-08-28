import { z } from 'zod'
import type { ErrorCode } from '../constants.js'

/**
 * 表单里的空串一律当成「没填」，避免数据库里混进 '' 和 null 两种空值。
 * 缺省（undefined）同样归一成 null —— 存草稿时前端只会提交填了的字段，
 * 不能因为「没传这个 key」就把整个请求判为校验失败。
 */
export const emptyToNull = (v: unknown): unknown => {
  if (v === undefined) return null
  return typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v
}

/** 可空的受限长度文本。key 可以整个不传。 */
export function nullableText(max: number, label: string) {
  return z.preprocess(
    emptyToNull,
    z
      .string()
      .max(max, `${label}不能超过 ${max} 个字符`)
      .nullable(),
  )
}

/** 可空的枚举。key 可以整个不传。 */
export function nullableEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(emptyToNull, z.enum(values).nullable())
}

/** 必填的受限长度文本 */
export function requiredText(max: number, label: string) {
  return z.preprocess(
    emptyToNull,
    z
      .string({ required_error: `${label}不能为空`, invalid_type_error: `${label}不能为空` })
      .min(1, `${label}不能为空`)
      .max(max, `${label}不能超过 ${max} 个字符`),
  )
}

/** 'YYYY-MM-DD'，可空 */
export const nullableDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .nullable(),
)

/**
 * 金额用字符串传输：JSON 的 number 是双精度浮点，
 * 123456789.15 这种值往返一次就可能变成 123456789.14999998。
 */
export const nullableAmount = z.preprocess(
  (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : null
    return emptyToNull(v)
  },
  z
    .string()
    .regex(/^\d{1,16}(\.\d{1,2})?$/, '金额格式不正确，最多 16 位整数、2 位小数')
    .nullable(),
)

/* ── 统一响应格式 ───────────────────────────────────────────────────── */

export interface ApiMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ApiSuccess<T> {
  data: T
  meta?: ApiMeta
}

export interface FieldIssue {
  field: string
  message: string
}

export interface ApiFailure {
  error: {
    code: ErrorCode
    message: string
    /** 校验类错误带上逐字段问题，前端据此把红字挂到对应输入框下 */
    issues?: FieldIssue[]
  }
}

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
