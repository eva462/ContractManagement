import {
  computeExpiryState,
  dateToDateString,
  type AmountType,
  type ContractDetail,
  type ContractListItem,
  type ContractStatus,
  type ContractType,
  type Currency,
  type Role,
  type UserBrief,
} from '@contract/shared'
import type { Actor } from '../../types.js'
import { toUserBrief, userBriefSelect, type UserRow } from '../user/mapper.js'
import { contractPermissions } from './permissions.js'

export const contractListInclude = {
  owner: { select: userBriefSelect },
  _count: { select: { attachments: true } },
} as const

export const contractDetailInclude = {
  owner: { select: userBriefSelect },
  createdBy: { select: userBriefSelect },
  updatedBy: { select: userBriefSelect },
  _count: { select: { attachments: true } },
} as const

/** 结构化描述，Prisma 查出来的行天然满足；不去纠缠 Prisma 的泛型推导。 */
export interface ContractRow {
  id: string
  contractNo: string | null
  title: string
  contractType: string | null
  counterpartyName: string | null
  counterpartyContact: string | null
  amountType: string | null
  amount: unknown
  currency: string
  paymentTerms: string | null
  signDate: Date | null
  effectiveDate: Date | null
  expiryDate: Date | null
  isPerpetual: boolean
  ownerId: string | null
  status: string
  archivedFrom: string | null
  originalLocation: string | null
  remark: string | null
  terminatedAt: Date | null
  terminationReason: string | null
  createdAt: Date
  updatedAt: Date
  owner?: UserRow | null
  createdBy?: UserRow | null
  updatedBy?: UserRow | null
  _count?: { attachments: number }
}

/** Decimal → 字符串。金额全程以字符串传输，JSON 里绝不出现浮点。 */
export function decimalToString(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && typeof (v as { toFixed?: unknown }).toFixed === 'function') {
    return (v as { toFixed: (n: number) => string }).toFixed(2)
  }
  return String(v)
}

export function toListItem(row: ContractRow): ContractListItem {
  const status = row.status as ContractStatus
  const expiryDate = dateToDateString(row.expiryDate)

  return {
    id: row.id,
    contractNo: row.contractNo,
    title: row.title,
    contractType: row.contractType as ContractType | null,
    counterpartyName: row.counterpartyName,
    amountType: row.amountType as AmountType | null,
    amount: decimalToString(row.amount),
    currency: row.currency as Currency,
    signDate: dateToDateString(row.signDate),
    effectiveDate: dateToDateString(row.effectiveDate),
    expiryDate,
    isPerpetual: row.isPerpetual,
    status,
    // 服务端算好一起返回，前端不重复算 —— 两边各算一次迟早会不一致
    expiryState: computeExpiryState({ status, isPerpetual: row.isPerpetual, expiryDate }),
    owner: toUserBrief(row.owner),
    attachmentCount: row._count?.attachments ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toDetail(row: ContractRow, actor: Actor): ContractDetail {
  return {
    ...toListItem(row),
    counterpartyContact: row.counterpartyContact,
    paymentTerms: row.paymentTerms,
    originalLocation: row.originalLocation,
    remark: row.remark,
    terminatedAt: dateToDateString(row.terminatedAt),
    terminationReason: row.terminationReason,
    archivedFrom: row.archivedFrom as ContractStatus | null,
    createdBy: toUserBrief(row.createdBy),
    updatedBy: toUserBrief(row.updatedBy),
    permissions: contractPermissions(actor, {
      ownerId: row.ownerId,
      status: row.status as ContractStatus,
    }),
  }
}
