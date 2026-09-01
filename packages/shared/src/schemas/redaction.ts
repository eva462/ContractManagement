import { z } from 'zod'

/**
 * 涂抹：把合同里不该出网的部分（主要是金额）在送去识别之前抠掉。
 *
 * ⚠️ 两条铁律，实现时不要绕过：
 *
 * 1. **画黑框不等于涂掉。** 在 PDF 上盖一个矩形，文字层还在下面。本系统对
 *    电子版 PDF 走的是文本层路径，界面上画框对送出去的内容毫无影响 ——
 *    必须按坐标真的把字符剔掉。详见 docs/design/04 §2。
 *
 * 2. **涂抹只作用于送去识别的副本，存档的 PDF 原件完整保留。**
 *    否则归档合同缺了金额，这个系统就没意义了。
 */

/**
 * 一个涂抹矩形。
 *
 * 坐标**归一化成页面宽高的比例**（0–1），不是像素 —— 前端预览图的缩放比例
 * 和后端渲染的缩放比例不一样，用像素必错。
 */
export const RedactionRectSchema = z.object({
  /** 页码，从 0 开始 */
  page: z.number().int().min(0).max(999),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
})

export type RedactionRect = z.output<typeof RedactionRectSchema>

/** 一次识别最多涂几块。够用且防止有人塞几万个矩形把服务拖垮。 */
export const MAX_REDACTIONS = 200

export const RedactionListSchema = z
  .array(RedactionRectSchema)
  .max(MAX_REDACTIONS, `涂抹区域最多 ${MAX_REDACTIONS} 个`)

/** 识别请求里带的涂抹信息，multipart 里以 JSON 字符串传 */
export function parseRedactions(raw: unknown): RedactionRect[] {
  if (raw === null || raw === undefined || raw === '') return []
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return []
    }
  }
  const parsed = RedactionListSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/** 写进留痕的摘要。**刻意不记录被涂掉的内容本身** —— 记了就等于没涂。 */
export function describeRedactions(rects: RedactionRect[]): string {
  if (rects.length === 0) return '未涂抹'
  const pages = [...new Set(rects.map((r) => r.page + 1))].sort((a, b) => a - b)
  return `涂抹 ${rects.length} 处，覆盖第 ${pages.join('、')} 页`
}

/**
 * 检测到的疑似金额位置。**纯提示，不自动涂** ——
 * 「税率 13%」这类也会被模式命中，该涂什么终究得人定。
 */
export interface DetectedAmount {
  /** 原文，让用户知道要涂的是哪个 */
  text: string
  x: number
  y: number
  w: number
  h: number
}

/** 一页预览图。服务端本地渲染，前端拿它当画布拉涂抹框。 */
export interface PagePreview {
  pageIndex: number
  /** base64 PNG（data URI 的 payload 部分） */
  imageBase64: string
  width: number
  height: number
  /**
   * 这一页里像金额的地方。中文合同的金额常写两遍（大写 + 小写、
   * 同行不同位置），只框住一个很容易漏 —— 所以全标出来让人一眼看见。
   * 扫描件没有文本层，这里会是空数组。
   */
  amounts: DetectedAmount[]
}
