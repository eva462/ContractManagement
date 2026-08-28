import type { ContractStatus, Role } from './enums.js'

/* ── 状态流转 ───────────────────────────────────────────────────────── */

export const CONTRACT_ACTION_VALUES = ['ACTIVATE', 'TERMINATE', 'ARCHIVE', 'UNARCHIVE'] as const
export type ContractAction = (typeof CONTRACT_ACTION_VALUES)[number]

export interface ContractActionDef {
  label: string
  /** 允许从哪些状态执行 */
  from: readonly ContractStatus[]
  /** 目标状态。null = 回到归档前的状态（存在 archivedFrom 字段里） */
  to: ContractStatus | null
  /** 该角色及以上无条件可执行 */
  minRole: Role
  /** 经办人本人是否在 minRole 之外额外放行 */
  ownerAllowed: boolean
  /** 执行前是否要求全部必填字段齐全 */
  requiresComplete: boolean
  /** 是否必须填写原因 */
  needsReason: boolean
  /** 前端二次确认文案；空字符串 = 不需要二次确认 */
  confirm: string
  /** 危险操作，前端用红色按钮 */
  danger: boolean
}

export const CONTRACT_ACTIONS: Record<ContractAction, ContractActionDef> = {
  ACTIVATE: {
    label: '提交生效',
    from: ['DRAFT'],
    to: 'ACTIVE',
    minRole: 'MANAGER',
    ownerAllowed: true,
    requiresComplete: true,
    needsReason: false,
    confirm: '',
    danger: false,
  },
  TERMINATE: {
    label: '终止合同',
    from: ['ACTIVE'],
    to: 'TERMINATED',
    minRole: 'MANAGER',
    ownerAllowed: false,
    requiresComplete: false,
    needsReason: true,
    confirm: '',
    danger: true,
  },
  ARCHIVE: {
    label: '归档',
    from: ['ACTIVE', 'TERMINATED'],
    to: 'ARCHIVED',
    minRole: 'MANAGER',
    ownerAllowed: false,
    requiresComplete: false,
    needsReason: false,
    confirm: '归档后该合同变为只读，不能再编辑或增删附件。确定归档？',
    danger: false,
  },
  UNARCHIVE: {
    label: '解除归档',
    from: ['ARCHIVED'],
    to: null,
    minRole: 'ADMIN',
    ownerAllowed: false,
    requiresComplete: false,
    needsReason: false,
    confirm: '解除归档会让合同重新变为可编辑，此操作会被记入操作留痕。确定解除？',
    danger: true,
  },
}

/** 只有草稿能删。这是合同系统的底线，不要在别处再开口子。 */
export const DELETABLE_STATUSES: readonly ContractStatus[] = ['DRAFT']

/** 归档后全部只读：不能编辑、不能传附件、不能删附件。 */
export const READONLY_STATUSES: readonly ContractStatus[] = ['ARCHIVED']

/* ── 字段中文名 ─────────────────────────────────────────────────────── */

/** 审计摘要和 diff 展示共用。加字段时记得在这里补一行，否则留痕里会显示英文字段名。 */
export const CONTRACT_FIELD_LABEL: Record<string, string> = {
  contractNo: '合同编号',
  title: '合同名称',
  contractType: '合同类型',
  counterpartyName: '对方单位',
  counterpartyContact: '对方联系人',
  amountType: '金额类型',
  amount: '合同金额',
  currency: '币种',
  paymentTerms: '付款结算方式',
  signDate: '签订日期',
  effectiveDate: '生效日期',
  expiryDate: '到期日期',
  isPerpetual: '长期有效',
  ownerId: '经办人',
  status: '状态',
  originalLocation: '原件存放位置',
  remark: '备注',
  terminatedAt: '终止日期',
  terminationReason: '终止原因',
}

/** 表单上出现、且用户可直接编辑的字段。状态和终止信息只能通过流转接口改。 */
export const CONTRACT_EDITABLE_FIELDS = [
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
  'ownerId',
  'originalLocation',
  'remark',
] as const

/** 提交生效时必须齐全的字段 */
export const CONTRACT_REQUIRED_FOR_ACTIVE = [
  'contractNo',
  'title',
  'contractType',
  'counterpartyName',
  'amountType',
  'signDate',
  'effectiveDate',
  'ownerId',
] as const

/* ── 附件 ──────────────────────────────────────────────────────────── */

export interface AllowedFileType {
  ext: string
  mimes: readonly string[]
  label: string
}

export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { ext: '.pdf', mimes: ['application/pdf'], label: 'PDF' },
  { ext: '.jpg', mimes: ['image/jpeg'], label: 'JPG' },
  { ext: '.jpeg', mimes: ['image/jpeg'], label: 'JPEG' },
  { ext: '.png', mimes: ['image/png'], label: 'PNG' },
  {
    ext: '.docx',
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    label: 'DOCX',
  },
  {
    ext: '.xlsx',
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    label: 'XLSX',
  },
]

export const ALLOWED_EXTENSIONS = ALLOWED_FILE_TYPES.map((t) => t.ext)
export const ALLOWED_MIMES = [...new Set(ALLOWED_FILE_TYPES.flatMap((t) => t.mimes))]

/** 能在页面里直接看的类型，其余给下载 */
export const PREVIEWABLE_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const

/* ── 分页 ──────────────────────────────────────────────────────────── */

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

/* ── 错误码 ────────────────────────────────────────────────────────── */

/** 前端靠这些码做特殊处理（比如把错误定位到某个输入框），不要靠匹配中文消息。 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONTRACT_NO_DUPLICATED: 'CONTRACT_NO_DUPLICATED',
  CONTRACT_NOT_FOUND: 'CONTRACT_NOT_FOUND',
  CONTRACT_READONLY: 'CONTRACT_READONLY',
  CONTRACT_NOT_DELETABLE: 'CONTRACT_NOT_DELETABLE',
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',
  INCOMPLETE_FOR_ACTIVATION: 'INCOMPLETE_FOR_ACTIVATION',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  ATTACHMENT_TYPE_REJECTED: 'ATTACHMENT_TYPE_REJECTED',
  ATTACHMENT_TOO_LARGE: 'ATTACHMENT_TOO_LARGE',
  ATTACHMENT_LIMIT_REACHED: 'ATTACHMENT_LIMIT_REACHED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  BAD_CREDENTIALS: 'BAD_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]
