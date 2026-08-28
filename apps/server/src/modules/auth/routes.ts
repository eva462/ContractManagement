import type { FastifyInstance } from 'fastify'
import {
  ChangePasswordSchema,
  LoginSchema,
  RefreshSchema,
  type LoginResult,
} from '@contract/shared'
import { currentUser, requestMeta, requireAuth } from '../../auth/guards.js'
import { auth } from '../../context.js'
import { db } from '../../db.js'
import { badCredentials, unauthorized, validationFailed } from '../../http/errors.js'
import { parseOrThrow } from '../../http/validate.js'
import { writeAudit } from '../audit/service.js'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (req) => {
    const body = parseOrThrow(LoginSchema, req.body)
    const meta = requestMeta(req)

    const user = await auth.authenticate(body, meta)

    if (!user) {
      // 失败也留痕。连续失败记录是发现异常尝试的唯一线索。
      await db.$transaction(async (tx) => {
        await writeAudit(tx, {
          entityType: 'USER',
          entityId: body.username,
          action: 'LOGIN_FAILED',
          userId: null,
          userName: body.username,
          summary: `账号「${body.username}」登录失败`,
          changes: null,
          ...meta,
        })
      })
      throw badCredentials()
    }

    const tokens = await auth.issueTokens(user)

    await db.$transaction(async (tx) => {
      await writeAudit(tx, {
        entityType: 'USER',
        entityId: user.id,
        action: 'LOGIN',
        userId: user.id,
        userName: user.displayName,
        summary: `${user.displayName} 登录系统`,
        changes: null,
        ...meta,
      })
    })

    const result: LoginResult = { ...tokens, user }
    return { data: result }
  })

  app.post('/auth/refresh', async (req) => {
    const body = parseOrThrow(RefreshSchema, req.body)
    const result = await auth.exchangeRefreshToken(body.refreshToken)
    if (!result) throw unauthorized('登录已过期，请重新登录')
    return { data: { ...result.tokens, user: result.user } satisfies LoginResult }
  })

  app.post('/auth/logout', async (req) => {
    const body = parseOrThrow(RefreshSchema, req.body)
    await auth.revokeRefreshToken(body.refreshToken)
    return { data: { ok: true } }
  })

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    return { data: currentUser(req) }
  })

  app.post('/auth/change-password', { preHandler: requireAuth }, async (req) => {
    const body = parseOrThrow(ChangePasswordSchema, req.body)
    const user = currentUser(req)

    const ok = await auth.changePassword(user.id, body.currentPassword, body.newPassword)
    if (!ok) {
      throw validationFailed([{ field: 'currentPassword', message: '当前密码不正确' }])
    }
    // 改完密码所有设备都要重新登录（provider 内部已作废全部 refresh token）
    return { data: { ok: true } }
  })
}
