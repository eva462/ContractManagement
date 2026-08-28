import type { Role } from '@contract/shared'

/**
 * 跨模块通用类型。
 *
 * 这些概念不属于任何一个业务模块 —— 合同、附件、审批、用户管理都要用。
 * 之前它们住在 modules/contract 里，导致 attachment 和 user 反过来 import
 * contract，把「合同模块」变成了谁都拆不走的地基。放这里就没这个问题。
 */

/** 做操作的人，权限判定只需要这两样 */
export interface Actor {
  id: string
  role: Role
}

/** 需要写留痕时还要人名快照 —— 用户改名或删号后历史记录仍然可读 */
export interface ActingUser extends Actor {
  displayName: string
}

/** 请求来源，写进留痕用于区分 Web / App / 异常访问 */
export interface RequestMeta {
  ip: string | null
  userAgent: string | null
}

/**
 * 把登录态用户转成 ActingUser。
 *
 * 每个需要写留痕的路由都要做这一步，之前 contract 和 attachment 各写了一遍，
 * 收到这里避免以后新模块再复制第三遍。
 */
export const actorOf = (u: { id: string; role: string; displayName: string }): ActingUser => ({
  id: u.id,
  role: u.role as Role,
  displayName: u.displayName,
})
