import type { FastifyInstance } from 'fastify'
import {
  ErrorCode,
  ReviewRuleCreateSchema,
  ReviewRuleUpdateSchema,
} from '@contract/shared'
import { actingUser, requireAuth, requireRole } from '../../auth/guards.js'
import { db } from '../../db.js'
import { badRequest, notFound } from '../../http/errors.js'
import { parseOrThrow } from '../../http/validate.js'
import { ensureGenericTemplate, latestReview, listTemplates, runReview } from './service.js'

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /** 详情页要显示的那一次审查。没审过返回 null，前端据此显示「未审查」。 */
  app.get<{ Params: { id: string } }>('/contracts/:id/review', async (req) => ({
    data: await latestReview(req.params.id),
  }))

  /**
   * 手动重跑一次审查。
   *
   * 提交审核时会自动跑一次，但那次可能失败（网络、key、扫描件没文本层），
   * 或者规则改了想重审 —— 所以留一个手动入口。这个是同步等结果的：
   * 用户是主动点的，看着转圈是预期内的。
   */
  app.post<{ Params: { id: string } }>(
    '/contracts/:id/review',
    { preHandler: requireRole('MANAGER') },
    async (req) => ({ data: await runReview(req.params.id, actingUser(req).id) }),
  )

  /* ── 规则模板 ───────────────────────────────────────────────────── */

  app.get('/review-templates', async () => ({ data: await listTemplates() }))

  app.post(
    '/review-templates/generic/rules',
    { preHandler: requireRole('MANAGER') },
    async (req, reply) => {
      const input = parseOrThrow(ReviewRuleCreateSchema, req.body)
      const templateId = await ensureGenericTemplate()
      const created = await db.reviewRule.create({
        data: { templateId, ...input, isDraft: false },
      })
      reply.code(201)
      return { data: created }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/review-rules/:id',
    { preHandler: requireRole('MANAGER') },
    async (req) => {
      const input = parseOrThrow(ReviewRuleUpdateSchema, req.body)
      if (Object.keys(input).length === 0) {
        throw badRequest(ErrorCode.VALIDATION_FAILED, '没有要修改的内容')
      }
      const existing = await db.reviewRule.findUnique({ where: { id: req.params.id } })
      if (!existing) throw notFound(ErrorCode.VALIDATION_FAILED, '规则不存在')
      return { data: await db.reviewRule.update({ where: { id: req.params.id }, data: input }) }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/review-rules/:id',
    { preHandler: requireRole('MANAGER') },
    async (req) => {
      const existing = await db.reviewRule.findUnique({ where: { id: req.params.id } })
      if (!existing) throw notFound(ErrorCode.VALIDATION_FAILED, '规则不存在')
      // 规则不像字典项那样被业务数据引用 —— 风险点存的是标题快照，
      // 所以删规则不会让历史审查结果变成孤儿，可以真删。
      await db.reviewRule.delete({ where: { id: req.params.id } })
      return { data: { ok: true } }
    },
  )
}
