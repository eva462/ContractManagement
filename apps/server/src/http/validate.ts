import type { ZodTypeAny, z } from 'zod'
import type { FieldIssue } from '@contract/shared'
import { validationFailed } from './errors.js'

/**
 * Zod 校验失败 → 统一的 FieldIssue[]，前端据此把红字挂到对应输入框。
 * 路由层一律走这个函数，不要直接 schema.parse —— 否则抛出的是 ZodError，
 * 前端拿到的错误结构就不一致了。
 */
export function parseOrThrow<T extends ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const issues: FieldIssue[] = result.error.issues.map((i) => ({
    field: i.path.length > 0 ? i.path.join('.') : '_',
    message: i.message,
  }))
  throw validationFailed(issues)
}
