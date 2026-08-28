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
 * 只有 4 个存储状态。「已到期」不在这里 —— 它由 expiryDate 实时派生，
 * 见 ExpiryState，这样不需要定时任务，也不会出现状态与日期对不上的脏数据。
 */
export const CONTRACT_STATUS_VALUES = ['DRAFT', 'ACTIVE', 'TERMINATED', 'ARCHIVED'] as const
export type ContractStatus = (typeof CONTRACT_STATUS_VALUES)[number]

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '履行中',
  TERMINATED: '已终止',
  ARCHIVED: '已归档',
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
}
