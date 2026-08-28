import type { FastifyInstance } from 'fastify'
import { UserCreateSchema, UserUpdateSchema, type Role, type UserBrief } from '@contract/shared'
import { z } from 'zod'
import { currentUser, requestMeta, requireAuth, requireRole } from '../../auth/guards.js'
import { auth } from '../../context.js'
import { db } from '../../db.js'
import { conflict, notFound } from '../../http/errors.js'
import { ErrorCode } from '@contract/shared'
import { parseOrThrow } from '../../http/validate.js'
import { writeAudit } from '../audit/service.js'
import { userBriefSelect } from './mapper.js'

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8, '密码至少 8 位').max(200),
})

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /** 经办人下拉框也用这个接口，所以所有登录用户都能读到基本信息（不含密码哈希）。 */
  app.get('/users', async () => {
    const rows = await db.user.findMany({
      where: { isActive: true },
      select: userBriefSelect,
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    })
    return { data: rows as UserBrief[] }
  })

  app.get('/users/all', { preHandler: requireRole('ADMIN') }, async () => {
    const rows = await db.user.findMany({
      select: { ...userBriefSelect, isActive: true, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { displayName: 'asc' }],
    })
    return { data: rows }
  })

  app.post('/users', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const body = parseOrThrow(UserCreateSchema, req.body)
    const actor = currentUser(req)

    const exists = await db.user.findUnique({ where: { username: body.username } })
    if (exists) {
      throw conflict(ErrorCode.VALIDATION_FAILED, '用户名已存在', [
        { field: 'username', message: '该用户名已被占用' },
      ])
    }

    const created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: body.username,
          displayName: body.displayName,
          passwordHash: await auth.hashPassword(body.password),
          role: body.role as Role,
        },
        select: { ...userBriefSelect, isActive: true },
      })
      await writeAudit(tx, {
        entityType: 'USER',
        entityId: user.id,
        action: 'CREATE',
        userId: actor.id,
        userName: actor.displayName,
        summary: `${actor.displayName} 创建了用户「${body.displayName}」（${body.username}）`,
        changes: null,
        ...requestMeta(req),
      })
      return user
    })

    reply.code(201)
    return { data: created }
  })

  app.patch('/users/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const { id } = req.params as { id: string }
    const body = parseOrThrow(UserUpdateSchema, req.body)
    const actor = currentUser(req)

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) throw notFound(ErrorCode.VALIDATION_FAILED, '用户不存在')

    const updated = await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: body as never,
        select: { ...userBriefSelect, isActive: true },
      })
      await writeAudit(tx, {
        entityType: 'USER',
        entityId: id,
        action: 'UPDATE',
        userId: actor.id,
        userName: actor.displayName,
        summary: `${actor.displayName} 修改了用户「${existing.displayName}」的信息`,
        changes: Object.fromEntries(
          Object.entries(body).map(([k, v]) => [
            k,
            { before: (existing as Record<string, unknown>)[k] ?? null, after: v ?? null },
          ]),
        ),
        ...requestMeta(req),
      })
      return user
    })

    // 停用账号后立刻踢掉已有会话
    if (body.isActive === false) await auth.revokeAllForUser(id)

    return { data: updated }
  })

  app.post('/users/:id/reset-password', { preHandler: requireRole('ADMIN') }, async (req) => {
    const { id } = req.params as { id: string }
    const body = parseOrThrow(ResetPasswordSchema, req.body)
    const actor = currentUser(req)

    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) throw notFound(ErrorCode.VALIDATION_FAILED, '用户不存在')

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: await auth.hashPassword(body.newPassword) },
      })
      await writeAudit(tx, {
        entityType: 'USER',
        entityId: id,
        action: 'UPDATE',
        userId: actor.id,
        userName: actor.displayName,
        summary: `${actor.displayName} 重置了用户「${existing.displayName}」的密码`,
        changes: null,
        ...requestMeta(req),
      })
    })

    await auth.revokeAllForUser(id)
    return { data: { ok: true } }
  })
}
