import type { FastifyRequest } from 'fastify'
import { actorOf, type ActingUser } from '../types.js'
import { roleAtLeast, type AuthenticatedUser, type Role } from '@contract/shared'
import { auth } from '../context.js'
import { db } from '../db.js'
import { forbidden, tokenExpired, unauthorized } from '../http/errors.js'

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser
  }
}

/**
 * 每次请求都回库查一次用户。5-10 人的系统这点开销可以忽略，
 * 换来的是停用账号立刻生效，而不用等 access token 自然过期。
 */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) throw unauthorized()

  const claims = await auth.verifyAccessToken(header.slice('Bearer '.length))
  if (!claims) throw tokenExpired()

  const user = await db.user.findUnique({ where: { id: claims.userId } })
  if (!user || !user.isActive) throw unauthorized('账号不存在或已停用')

  req.currentUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role as Role,
    isActive: user.isActive,
  }
}

export function currentUser(req: FastifyRequest): AuthenticatedUser {
  if (!req.currentUser) throw unauthorized()
  return req.currentUser
}

/**
 * 当前用户 → 服务层要的 ActingUser。
 * 路由层统一用这个，别再各写一份转换。
 */
export function actingUser(req: FastifyRequest): ActingUser {
  return actorOf(currentUser(req))
}

/** 角色门槛。注意这是接口级的粗粒度守卫，行级权限在 service 里另判。 */
export function requireRole(min: Role) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!roleAtLeast(currentUser(req).role, min)) {
      throw forbidden()
    }
  }
}

export function requestMeta(req: FastifyRequest): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  }
}
