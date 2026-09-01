/**
 * 全部业务枚举。值必须与 apps/server/prisma/schema.prisma 里的 enum 逐字一致。
 * 中文 label 在这里定义一次，前端展示和后端审计摘要共用，避免两边翻译不同步。
 */

/* ── 角色 ──────────────────────────────────────────────────────────── */

export const ROLE_VALUES = ['ADMIN', 'MANAGER', 'STAFF'] as const
export type Role = (typeof ROLE_VALUES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: '系统管理员',
  MANAGER: '合同管理员',
  STAFF: '经办人',
}

/** 角色高低。用于 minRole 比较，数字大的权限大。 */
export const ROLE_RANK: Record<Role, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
}

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

/* ── 合同状态 ───────────────────────────────────────────────────────── */

/**
 * 合同生命周期。「已到期」不在这里 —— 它由 expiryDate 实时派生（见 ExpiryState），
 * 这样不需要定时任务，也不会出现状态与日期对不上的脏数据。
 *
 * ⚠️ 「归档」在业务里有两个相反的意思，这里刻意用了两个词区分：
 *   PENDING_FILING「待归档」= 纸质原件入档 + 扫描件上传，是**生效前的一道关口**
 *   CLOSED「已完结」        = 合同完结封存、只读，是**终点**
 * 详见 docs/design/03-审批流程与设置模块.md §1。
 */
export const CONTRACT_STATUS_VALUES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING_SIGNING',
  'PENDING_FILING',
  'ACTIVE',
  'TERMINATED',
  'CLOSED',
] as const
export type ContractStatus = (typeof CONTRACT_STATUS_VALUES)[number]

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: '草稿',
  PENDING_APPROVAL: '待审核',
  PENDING_SIGNING: '待签署',
  PENDING_FILING: '待归档',
  ACTIVE: '履行中',
  TERMINATED: '已终止',
  CLOSED: '已完结',
}

/** 每个状态下一步该干什么，显示在详情页状态标签旁，让人知道球在谁那儿 */
export const CONTRACT_STATUS_HINT: Record<ContractStatus, string> = {
  DRAFT: '补齐信息后提交审核',
  PENDING_APPROVAL: '等待审核人处理',
  PENDING_SIGNING: '转线下纸面签署盖章，签完回来登记',
  PENDING_FILING: '上传签署后的扫描件并填写原件存放位置',
  ACTIVE: '正常履行中',
  TERMINATED: '已提前解除',
  CLOSED: '已完结封存，只读',
}

/* ── 审批 ──────────────────────────────────────────────────────────── */

export const APPROVAL_DECISION_VALUES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type ApprovalDecision = (typeof APPROVAL_DECISION_VALUES)[number]

export const APPROVAL_DECISION_LABEL: Record<ApprovalDecision, string> = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
}

/* ── 到期派生态（不落库）────────────────────────────────────────────── */

export const EXPIRY_STATE_VALUES = ['NONE', 'PERPETUAL', 'NORMAL', 'EXPIRING', 'EXPIRED'] as const
export type ExpiryState = (typeof EXPIRY_STATE_VALUES)[number]

export const EXPIRY_STATE_LABEL: Record<ExpiryState, string> = {
  NONE: '',
  PERPETUAL: '长期有效',
  NORMAL: '',
  EXPIRING: '即将到期',
  EXPIRED: '已过期',
}

/** 到期前多少天开始显示「即将到期」 */
export const EXPIRING_SOON_DAYS = 30

/* ── 合同类型 ───────────────────────────────────────────────────────── */

export const CONTRACT_TYPE_VALUES = [
  'PURCHASE',
  'SALES',
  'SERVICE',
  'LEASE',
  'LABOR',
  'NDA',
  'FRAMEWORK',
  'OTHER',
] as const
export type ContractType = (typeof CONTRACT_TYPE_VALUES)[number]

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  PURCHASE: '采购',
  SALES: '销售',
  SERVICE: '服务',
  LEASE: '租赁',
  LABOR: '劳务',
  NDA: '保密',
  FRAMEWORK: '框架',
  OTHER: '其他',
}

/**
 * 合同编号前缀。编号格式 `{前缀}-{年份}-{4位流水}`，例如 CG-2026-0001。
 * 想改成全局统一流水（HT-2026-0001），把这张表全部改成同一个前缀即可。
 */
export const CONTRACT_TYPE_PREFIX: Record<ContractType, string> = {
  PURCHASE: 'CG',
  SALES: 'XS',
  SERVICE: 'FW',
  LEASE: 'ZL',
  LABOR: 'LW',
  NDA: 'BM',
  FRAMEWORK: 'KJ',
  OTHER: 'QT',
}

/* ── 金额 ──────────────────────────────────────────────────────────── */

export const AMOUNT_TYPE_VALUES = ['TAX_INCLUDED', 'TAX_EXCLUDED', 'NO_AMOUNT'] as const
export type AmountType = (typeof AMOUNT_TYPE_VALUES)[number]

export const AMOUNT_TYPE_LABEL: Record<AmountType, string> = {
  TAX_INCLUDED: '含税',
  TAX_EXCLUDED: '不含税',
  NO_AMOUNT: '无金额',
}

export const CURRENCY_VALUES = ['CNY', 'USD', 'EUR', 'HKD'] as const
export type Currency = (typeof CURRENCY_VALUES)[number]

export const CURRENCY_LABEL: Record<Currency, string> = {
  CNY: '人民币',
  USD: '美元',
  EUR: '欧元',
  HKD: '港币',
}

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  HKD: 'HK$',
}

/* ── 附件 ──────────────────────────────────────────────────────────── */

export const ATTACHMENT_TYPE_VALUES = ['ORIGINAL', 'SUPPLEMENT', 'ANNEX', 'OTHER'] as const
export type AttachmentType = (typeof ATTACHMENT_TYPE_VALUES)[number]

export const ATTACHMENT_TYPE_LABEL: Record<AttachmentType, string> = {
  ORIGINAL: '合同正本',
  SUPPLEMENT: '补充协议',
  ANNEX: '附件',
  OTHER: '其他',
}

/* ── 审计 ──────────────────────────────────────────────────────────── */

export const AUDIT_ENTITY_VALUES = ['CONTRACT', 'ATTACHMENT', 'USER'] as const
export type AuditEntityType = (typeof AUDIT_ENTITY_VALUES)[number]

export const AUDIT_ACTION_VALUES = [
  'CREATE',
  'UPDATE',
  'STATUS_CHANGE',
  'DELETE',
  'UPLOAD',
  'DOWNLOAD',
  'LOGIN',
  'LOGIN_FAILED',
  'EXTRACT',
  'SUBMIT',
  'APPROVE',
  'REJECT',
  'WITHDRAW',
] as const
export type AuditAction = (typeof AUDIT_ACTION_VALUES)[number]

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  CREATE: '创建',
  UPDATE: '修改',
  STATUS_CHANGE: '状态流转',
  DELETE: '删除',
  UPLOAD: '上传附件',
  DOWNLOAD: '下载附件',
  LOGIN: '登录',
  LOGIN_FAILED: '登录失败',
  EXTRACT: '内容识别',
  SUBMIT: '提交审核',
  APPROVE: '审核通过',
  REJECT: '审核驳回',
  WITHDRAW: '撤回',
}
