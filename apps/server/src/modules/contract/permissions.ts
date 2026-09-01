import {
  CONTRACT_ACTIONS,
  CONTRACT_ACTION_VALUES,
  DELETABLE_STATUSES,
  ATTACHMENT_LOCKED_STATUSES,
  READONLY_STATUSES,
  roleAtLeast,
  type ContractAction,
  type ContractPermissions,
  type ContractStatus,
  type Role,
} from '@contract/shared'
import type { Actor } from '../../types.js'

/** 权限判定的对象。这个是合同特有的，留在本模块。 */
export interface ContractSubject {
  ownerId: string | null
  status: ContractStatus
}

export const isOwner = (actor: Actor, c: ContractSubject): boolean =>
  c.ownerId !== null && c.ownerId === actor.id

/**
 * 字段只读。已完结的合同对所有人只读，ADMIN 也不例外 —— 想改必须先「解除完结」，
 * 这样每一次对已完结合同的改动都会在留痕里留下明确的解封记录。
 * 待审核也在内：送审之后不许改，要改先撤回。
 */
const isReadonly = (c: ContractSubject) => READONLY_STATUSES.includes(c.status)

const OWNER_EDITABLE_STATUSES: readonly ContractStatus[] = ['DRAFT', 'PENDING_FILING', 'ACTIVE']

/** 附件只读。只有已完结才锁 —— 待归档正是要传扫描件的环节。 */
const isAttachmentLocked = (c: ContractSubject) => ATTACHMENT_LOCKED_STATUSES.includes(c.status)

export function canEdit(actor: Actor, c: ContractSubject): boolean {
  if (isReadonly(c)) return false
  if (roleAtLeast(actor.role, 'MANAGER')) return true
  // 经办人能改的状态：草稿、待归档（要填原件存放位置）、履行中。
  // 刻意不含待签署 —— 审完之后再改字段，会让审的和签的变成两份东西。
  return isOwner(actor, c) && OWNER_EDITABLE_STATUSES.includes(c.status)
}

export function canDelete(actor: Actor, c: ContractSubject): boolean {
  // 只有草稿能删。这条不因角色而放宽。
  if (!DELETABLE_STATUSES.includes(c.status)) return false
  if (roleAtLeast(actor.role, 'MANAGER')) return true
  return isOwner(actor, c)
}

export function canManageAttachments(actor: Actor, c: ContractSubject): boolean {
  if (isAttachmentLocked(c)) return false
  if (roleAtLeast(actor.role, 'MANAGER')) return true
  return isOwner(actor, c)
}

export function canRunAction(actor: Actor, c: ContractSubject, action: ContractAction): boolean {
  const def = CONTRACT_ACTIONS[action]
  if (!def.from.includes(c.status)) return false
  // 审批回避：自己提交的合同不能自己审，角色再高也不行
  if (def.forbidOwner && isOwner(actor, c)) return false
  if (roleAtLeast(actor.role, def.minRole)) return true
  return def.ownerAllowed && isOwner(actor, c)
}

export function availableActions(actor: Actor, c: ContractSubject) {
  return CONTRACT_ACTION_VALUES.filter((a) => canRunAction(actor, c, a)).map((a) => {
    const def = CONTRACT_ACTIONS[a]
    return {
      action: a,
      label: def.label,
      danger: def.danger,
      confirm: def.confirm,
      needsReason: def.needsReason,
      needsSignedDate: def.needsSignedDate,
    }
  })
}

/** 打包成响应里的 permissions 字段，前端据此决定按钮显隐。 */
export function contractPermissions(actor: Actor, c: ContractSubject): ContractPermissions {
  const attachments = canManageAttachments(actor, c)
  return {
    canEdit: canEdit(actor, c),
    canDelete: canDelete(actor, c),
    canUploadAttachment: attachments,
    canDeleteAttachment: attachments,
    actions: availableActions(actor, c),
  }
}
