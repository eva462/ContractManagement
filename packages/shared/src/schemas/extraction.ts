import { z } from 'zod'
import {
  AMOUNT_TYPE_VALUES,
  CONTRACT_TYPE_VALUES,
  CURRENCY_VALUES,
  type AmountType,
  type ContractType,
  type Currency,
} from '../enums.js'

/**
 * 合同内容识别的结果契约。
 *
 * 识别出来的值**永远不直接入库** —— 它只用来预填表单，由人核对后走
 * 和手工录入完全相同的接口保存。所以这里的类型跟 ContractWriteSchema
 * 刻意分开：一个是「机器猜的」，一个是「人确认的」。
 */

/** 只有这 13 个字段参与识别；其余是系统内部字段或只有人知道的信息。 */
export const EXTRACTABLE_FIELDS = [
  'contractNo',
  'title',
  'contractType',
  'counterpartyName',
  'counterpartyContact',
  'amountType',
  'amount',
  'currency',
  'paymentTerms',
  'signDate',
  'effectiveDate',
  'expiryDate',
  'isPerpetual',
] as const

export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number]

export const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCE_VALUES)[number]

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '较可靠',
  medium: '一般',
  low: '请重点核对',
}

export interface ExtractedField<T = unknown> {
  value: T | null
  confidence: Confidence
  /** 原文出处片段，让人能一眼确认这个值是从哪句话读出来的 */
  evidence: string | null
}

export type ExtractedFields = {
  [K in ExtractableField]?: ExtractedField
}

export interface ExtractionMeta {
  /** 实际用的模型，写进留痕 */
  model: string
  /** text = 走了 PDF 文本层；vision = 渲染成图片让模型看 */
  mode: 'text' | 'vision'
  pageCount: number
  /** vision 模式下实际送出的图片张数（每页切块后） */
  imageCount: number
  elapsedMs: number
  fieldCount: number
  lowConfidenceCount: number
}

export interface ExtractionResult {
  fields: ExtractedFields
  meta: ExtractionMeta
}

/** 没配 key 时前端据此隐藏识别入口，其余功能不受影响。 */
export interface ExtractionStatus {
  available: boolean
  provider: string
  /** 不可用时说明原因，直接显示给用户 */
  reason?: string
}

/* ── 模型返回值的校验 ────────────────────────────────────────────────
 *
 * DeepSeek 的 JSON 模式是 free-form 的，不支持传 schema 强制，
 * 所以返回什么完全靠自己校验。这里刻意宽松：
 * 任何一个字段不合规就丢掉那个字段，而不是整份作废 ——
 * 识别出 9 个字段里有 1 个格式不对，剩下 8 个仍然对用户有用。
 */

const rawField = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullish().transform((v) => v ?? null),
    confidence: z.enum(CONFIDENCE_VALUES).catch('low'),
    evidence: z.string().max(500).nullish().transform((v) => v ?? null),
  })

const looseDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期须为 YYYY-MM-DD')

const looseAmount = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, '金额格式不正确')

/** 逐字段校验的 schema 表。校验失败的字段直接丢弃，不影响其他字段。 */
export const EXTRACTED_FIELD_SCHEMAS = {
  contractNo: rawField(z.string().trim().max(64)),
  title: rawField(z.string().trim().max(255)),
  contractType: rawField(z.enum(CONTRACT_TYPE_VALUES)),
  counterpartyName: rawField(z.string().trim().max(255)),
  counterpartyContact: rawField(z.string().trim().max(64)),
  amountType: rawField(z.enum(AMOUNT_TYPE_VALUES)),
  amount: rawField(looseAmount),
  currency: rawField(z.enum(CURRENCY_VALUES)),
  paymentTerms: rawField(z.string().trim().max(2000)),
  signDate: rawField(looseDate),
  effectiveDate: rawField(looseDate),
  expiryDate: rawField(looseDate),
  isPerpetual: rawField(z.boolean()),
} as const

/** 前端拿到结果后转成表单值用的类型提示 */
export interface ExtractedContractValues {
  contractNo?: string
  title?: string
  contractType?: ContractType
  counterpartyName?: string
  counterpartyContact?: string
  amountType?: AmountType
  amount?: string
  currency?: Currency
  paymentTerms?: string
  signDate?: string
  effectiveDate?: string
  expiryDate?: string
  isPerpetual?: boolean
}
