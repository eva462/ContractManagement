import { z } from 'zod'

/**
 * 合同风险审查。
 *
 * 定位：**给审核人看的辅助材料，不是关卡。** 甲方原话是「原本有合同审核
 * 人员，增加 deepseek 审核环节只是简化条款审核工作，提升效率」——
 * 所以审查结果只展示，不阻断任何流转。
 *
 * 防幻觉的两条硬约束（实现时不要放宽）：
 *   1. **没有原文依据的风险点一律丢弃。** 模型编不出合同里没有的句子，
 *      编了也一眼能看穿。
 *   2. **每条风险点必须说明命中的是哪条规则。** 否则用户没法判断该不该信，
 *      也没法回头去调那条规则。
 */

export const RISK_SEVERITY_VALUES = ['HIGH', 'MEDIUM', 'LOW'] as const
export type RiskSeverity = (typeof RISK_SEVERITY_VALUES)[number]

export const RISK_SEVERITY_LABEL: Record<RiskSeverity, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
}

/** 排序用。高风险排前面。 */
export const RISK_SEVERITY_RANK: Record<RiskSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
}

export const REVIEW_STATUS_VALUES = ['RUNNING', 'DONE', 'FAILED'] as const
export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number]

/* ── 规则 ──────────────────────────────────────────────────────────── */

export interface ReviewRuleDto {
  id: string
  title: string
  detail: string
  severity: RiskSeverity
  sortOrder: number
  isActive: boolean
  /** AI 生成、还没被人逐条确认过。界面上要标出来，别让人以为是审过的。 */
  isDraft: boolean
}

export interface ReviewTemplateDto {
  id: string
  /** null = 通用模板，没有专属模板的合同类型都用它 */
  contractType: string | null
  name: string
  isActive: boolean
  rules: ReviewRuleDto[]
}

const ruleTitle = z.string().trim().min(2, '标题太短').max(80, '标题最多 80 字')
const ruleDetail = z
  .string()
  .trim()
  .min(10, '审查要点写具体些，太笼统模型只会泛泛而谈')
  .max(1000, '最多 1000 字')

export const ReviewRuleCreateSchema = z.object({
  title: ruleTitle,
  detail: ruleDetail,
  severity: z.enum(RISK_SEVERITY_VALUES).default('MEDIUM'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
})

export const ReviewRuleUpdateSchema = z.object({
  title: ruleTitle.optional(),
  detail: ruleDetail.optional(),
  severity: z.enum(RISK_SEVERITY_VALUES).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  /** 采纳一条 AI 生成的候选规则 = 把 isDraft 置为 false */
  isDraft: z.boolean().optional(),
})

export type ReviewRuleCreateInput = z.input<typeof ReviewRuleCreateSchema>
export type ReviewRuleUpdateInput = z.input<typeof ReviewRuleUpdateSchema>

/* ── 审查结果 ───────────────────────────────────────────────────────── */

export interface ReviewFindingDto {
  id: string
  /** 命中的规则标题（快照）。规则以后改了，历史记录不跟着变。 */
  ruleTitle: string
  severity: RiskSeverity
  summary: string
  /** 合同原文片段。**没有它的风险点不会入库。** */
  evidence: string
  suggestion: string | null
}

export interface ContractReviewDto {
  id: string
  status: ReviewStatus
  model: string | null
  error: string | null
  elapsedMs: number | null
  /** 审查时被涂抹掉了几处 —— 界面要提示「本次审查未包含被涂抹的部分」 */
  redactedCount: number
  createdAt: string
  finishedAt: string | null
  createdByName: string | null
  findings: ReviewFindingDto[]
}

/* ── 模型返回值的校验 ───────────────────────────────────────────────── */

/**
 * 跟识别一样：DeepSeek 的 JSON 模式不支持传 schema 强制，返回什么全靠自己校验。
 * 单条风险点不合规就丢那一条，不让整次审查作废。
 */
export const RawFindingSchema = z.object({
  ruleTitle: z.string().trim().min(1).max(120),
  severity: z.enum(RISK_SEVERITY_VALUES).catch('MEDIUM'),
  summary: z.string().trim().min(2).max(500),
  // 必填且要有实际内容 —— 这是防幻觉的关键，别改成可选
  evidence: z.string().trim().min(4, '必须给出合同原文依据').max(500),
  suggestion: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v ?? null),
})

export type RawFinding = z.output<typeof RawFindingSchema>
