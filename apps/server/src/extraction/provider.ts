import type { ExtractionResult, ExtractionStatus } from '@contract/shared'
import type { LoadedDocument } from './document-loader.js'

/**
 * ★ 字段识别可替换边界（第四个）
 *
 * 只负责「已经解析好的文档内容 → 结构化字段」这一段。
 * PDF 解析、渲染、切块在 document-loader.ts 里，**永远本地执行、不出网**，
 * 换 AI 供应商时那部分完全不受影响。
 *
 * 换成通义千问 / 智谱 / 本地 Qwen / Claude 时，写一个新实现，
 * 在 context.ts 里换掉即可，路由和前端一行不动。
 */
export interface FieldExtractor {
  readonly name: string

  /** 没配 key 时返回 available:false，前端据此隐藏识别入口。 */
  status(): ExtractionStatus

  /**
   * 从已解析的文档里抽合同字段。
   *
   * 实现约定：
   * - 读不出来的字段就不要放进结果，**不要编造**
   * - 每个字段必须带 confidence 和 evidence（原文出处）
   * - 校验不通过的单个字段应被丢弃，而不是让整次识别失败
   */
  extract(doc: LoadedDocument, signal?: AbortSignal): Promise<ExtractionResult>
}
