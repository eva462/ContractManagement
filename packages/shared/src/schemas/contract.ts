import { z } from 'zod'
import {
  AMOUNT_TYPE_VALUES,
  CONTRACT_STATUS_VALUES,
  CONTRACT_TYPE_VALUES,
  CURRENCY_VALUES,
  type AmountType,
  type ContractStatus,
  type ContractType,
  type Currency,
  type ExpiryState,
  type Role,
} from '../enums.js'
import {
  CONTRACT_ACTION_VALUES,
  CONTRACT_FIELD_LABEL,
  CONTRACT_REQUIRED_FOR_ACTIVE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../constants.js'
import {
  nullableAmount,
  nullableDate,
  nullableEnum,
  nullableText,
  requiredText,
  type FieldIssue,
} from './common.js'

/* ── 写入 ──────────────────────────────────────────────────────────── */

/**
 * 用户可直接编辑的字段。status / terminatedAt / terminationReason 不在这里 ——
 * 它们只能通过 POST /contracts/:id/status 改，避免有人用 PATCH 绕过流转规则。
 */
export const ContractWriteSchema = z.object({
  contractNo: nullableText(64, '合同编号'),
  title: requiredText(255, '合同名称'),
  contractType: nullableEnum(CONTRACT_TYPE_VALUES),
  counterpartyName: nullableText(255, '对方单位'),
  counterpartyContact: nullableText(64, '对方联系人'),
  amountType: nullableEnum(AMOUNT_TYPE_VALUES),
  amount: nullableAmount,
  currency: z.enum(CURRENCY_VALUES).default('CNY'),
  paymentTerms: nullableText(2000, '付款结算方式'),
  signDate: nullableDate,
  effectiveDate: nullableDate,
  expiryDate: nullableDate,
  isPerpetual: z.boolean().default(false),
  ownerId: nullableText(64, '经办人'),
  originalLocation: nullableText(255, '原件存放位置'),
  remark: nullableText(2000, '备注'),
})

export type ContractWriteInput = z.input<typeof ContractWriteSchema>
export type ContractWriteValues = z.output<typeof ContractWriteSchema>

export const ContractCreateSchema = ContractWriteSchema.extend({
  /** true = 直接提交生效（走完整校验），false/缺省 = 存为草稿 */
  activate: z.boolean().default(false),
})

export const ContractUpdateSchema = ContractWriteSchema.partial()

/* ── 业务规则校验 ───────────────────────────────────────────────────── */

type RuleInput = Partial<ContractWriteValues>

/**
 * 跨字段规则。前后端调同一个函数，规则只写一遍。
 *
 * strict = true 用于「提交生效」：必填字段必须齐全。
 * strict = false 用于「存草稿」：只拦互相矛盾的填法，不拦「还没填完」。
 */
export function validateContractRules(v: RuleInput, opts: { strict: boolean }): FieldIssue[] {
  const issues: FieldIssue[] = []
  const label = (f: string) => CONTRACT_FIELD_LABEL[f] ?? f
  const blank = (x: unknown) => x === null || x === undefined || x === ''

  if (opts.strict) {
    for (const f of CONTRACT_REQUIRED_FOR_ACTIVE) {
      if (blank(v[f as keyof RuleInput])) {
        issues.push({ field: f, message: `${label(f)}不能为空` })
      }
    }
  }

  // 金额类型与金额必须自洽 —— 这类矛盾在草稿态也要拦，否则数据本身就是错的
  if (v.amountType === 'NO_AMOUNT' && !blank(v.amount)) {
    issues.push({ field: 'amount', message: '金额类型为「无金额」时不应填写合同金额' })
  }
  if ((v.amountType === 'TAX_INCLUDED' || v.amountType === 'TAX_EXCLUDED') && blank(v.amount)) {
    issues.push({ field: 'amount', message: '请填写合同金额，或把金额类型改为「无金额」' })
  }

  // 长期有效与到期日期互斥
  if (v.isPerpetual === true && !blank(v.expiryDate)) {
    issues.push({ field: 'expiryDate', message: '已勾选「长期有效」，不应再填到期日期' })
  }
  if (opts.strict && v.isPerpetual !== true && blank(v.expiryDate)) {
    issues.push({ field: 'expiryDate', message: '请填写到期日期，或勾选「长期有效」' })
  }

  // 日期先后顺序
  if (!blank(v.signDate) && !blank(v.effectiveDate) && v.effectiveDate! < v.signDate!) {
    issues.push({ field: 'effectiveDate', message: '生效日期不能早于签订日期' })
  }
  if (!blank(v.effectiveDate) && !blank(v.expiryDate) && v.expiryDate! < v.effectiveDate!) {
    issues.push({ field: 'expiryDate', message: '到期日期不能早于生效日期' })
  }

  return issues
}

/* ── 查询 ──────────────────────────────────────────────────────────── */

export const CONTRACT_SORT_FIELDS = [
  'signDate',
  'amount',
  'expiryDate',
  'createdAt',
  'contractNo',
] as const
export type ContractSortField = (typeof CONTRACT_SORT_FIELDS)[number]

export const ContractQuerySchema = z.object({
  /** 同时匹配合同名称、合同编号、对方单位 */
  keyword: z.string().trim().max(200).optional(),
  status: z.enum(CONTRACT_STATUS_VALUES).optional(),
  /** 到期派生态筛选。EXPIRED / EXPIRING 都只在履行中的合同里找 */
  expiry: z.enum(['EXPIRED', 'EXPIRING']).optional(),
  contractType: z.enum(CONTRACT_TYPE_VALUES).optional(),
  ownerId: z.string().max(64).optional(),
  signDateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  signDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sort: z.enum(CONTRACT_SORT_FIELDS).default('signDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

export type ContractQuery = z.output<typeof ContractQuerySchema>

/* ── 状态流转 ───────────────────────────────────────────────────────── */

export const ContractStatusChangeSchema = z
  .object({
    action: z.enum(CONTRACT_ACTION_VALUES),
    terminationReason: nullableText(2000, '终止原因'),
    terminatedAt: nullableDate,
    /** 线下纸面签署完成的日期，登记签署时必填 */
    signedDate: nullableDate,
    /** 审批意见。驳回时必填，通过时可选 */
    comment: nullableText(2000, '审批意见'),
  })
  .superRefine((v, ctx) => {
    const need = (path: string, value: unknown, message: string): void => {
      if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })
    }
    if (v.action === 'TERMINATE') {
      need('terminationReason', v.terminationReason, '终止原因不能为空')
      need('terminatedAt', v.terminatedAt, '终止日期不能为空')
    }
    if (v.action === 'MARK_SIGNED') {
      need('signedDate', v.signedDate, '签署日期不能为空')
    }
    if (v.action === 'REJECT') {
      need('comment', v.comment, '驳回必须写明意见，否则经办人不知道该改什么')
    }
  })

export type ContractStatusChangeInput = z.input<typeof ContractStatusChangeSchema>

export const NextContractNoQuerySchema = z.object({
  contractType: z.enum(CONTRACT_TYPE_VALUES),
})

/* ── 响应 DTO ───────────────────────────────────────────────────────── */

export interface UserBrief {
  id: string
  username: string
  displayName: string
  role: Role
}

export interface ContractListItem {
  id: string
  contractNo: string | null
  title: string
  contractType: ContractType | null
  counterpartyName: string | null
  amountType: AmountType | null
  amount: string | null
  currency: Currency
  signDate: string | null
  effectiveDate: string | null
  expiryDate: string | null
  isPerpetual: boolean
  status: ContractStatus
  /** 服务端算好一起返回，前端不重复算，避免两边判定不一致 */
  expiryState: ExpiryState
  owner: UserBrief | null
  attachmentCount: number
  createdAt: string
  updatedAt: string
}

export interface ContractDetail extends ContractListItem {
  counterpartyContact: string | null
  paymentTerms: string | null
  originalLocation: string | null
  remark: string | null
  terminatedAt: string | null
  terminationReason: string | null
  closedFrom: ContractStatus | null
  createdBy: UserBrief | null
  updatedBy: UserBrief | null
  /** 当前登录用户在这条合同上能做什么，前端据此决定按钮显隐 */
  permissions: ContractPermissions
}

export interface ContractPermissions {
  canEdit: boolean
  canDelete: boolean
  canUploadAttachment: boolean
  canDeleteAttachment: boolean
  /** 当前可执行的流转动作 */
  actions: {
    action: (typeof CONTRACT_ACTION_VALUES)[number]
    label: string
    danger: boolean
    confirm: string
    needsReason: boolean
    needsSignedDate: boolean
  }[]
}
