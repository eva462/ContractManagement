import {
  CONTRACT_ACTIONS,
  CONTRACT_ACTION_VALUES,
  DELETABLE_STATUSES,
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
 * 归档后对所有人只读，ADMIN 也不例外 —— 想改必须先「解除归档」，
 * 这样每一次对已归档合同的改动都会在留痕里留下明确的解封记录。
 */
const isReadonly = (c: ContractSubject) => READONLY_STATUSES.includes(c.status)

export function canEdit(actor: Actor, c: ContractSubject): boolean {
  if (isReadonly(c)) return false
  if (roleAtLeast(actor.role, 'MANAGER')) return true
  return isOwner(actor, c) && (c.status === 'DRAFT' || c.status === 'ACTIVE')
}

export function canDelete(actor: Actor, c: ContractSubject): boolean {
  // 只有草稿能删。这条不因角色而放宽。
  if (!DELETABLE_STATUSES.includes(c.status)) return false
  if (roleAtLeast(actor.role, 'MANAGER')) return true
  return isOwner(actor, c)
}

export function canManageAttachments(actor: Actor, c: ContractSubject): boolean {
  if (isReadonly(c)) return false
  if (roleAtLeast(actor.role, 'MANAGER')) return true
  return isOwner(actor, c)
}

export function canRunAction(actor: Actor, c: ContractSubject, action: ContractAction): boolean {
  const def = CONTRACT_ACTIONS[action]
  if (!def.from.includes(c.status)) return false
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
