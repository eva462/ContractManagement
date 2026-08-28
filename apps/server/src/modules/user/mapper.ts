import type { Role, UserBrief } from '@contract/shared'

/**
 * 用户信息的查询字段与形状转换。
 *
 * 合同、附件、审批都要在返回里带上「谁经办 / 谁上传 / 谁审批」，
 * 用的都是这一份。放在 user 模块下是因为它描述的是用户，
 * 而不是合同 —— 之前它住在 contract/mapper.ts，导致 user 模块
 * 反过来 import contract，方向是反的。
 */

/** 所有带用户信息的查询都用这一份 select，避免各处字段不一致 */
export const userBriefSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
} as const

export interface UserRow {
  id: string
  username: string
  displayName: string
  role: string
}

export function toUserBrief(u: UserRow | null | undefined): UserBrief | null {
  if (!u) return null
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role as Role }
}
