import type { FastifyInstance } from 'fastify'
import {
  DICT_CODES,
  DictItemCreateSchema,
  DictItemUpdateSchema,
  DictQuerySchema,
  ErrorCode,
  type DictCode,
} from '@contract/shared'
import { actingUser, requestMeta, requireAuth, requireRole } from '../../auth/guards.js'
import { badRequest } from '../../http/errors.js'
import { parseOrThrow } from '../../http/validate.js'
import {
  createDictItem,
  deleteDictItem,
  listDictItems,
  updateDictItem,
} from './service.js'

function parseDictCode(raw: string): DictCode {
  if (!(DICT_CODES as readonly string[]).includes(raw)) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, `不认识的字典分组「${raw}」`)
  }
  return raw as DictCode
}

export async function dictRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /**
   * 读取字典项。**所有登录用户都能读** —— 新建合同页的下拉框需要它，
   * 不能只给管理员。默认只返回启用的项；设置页传 includeInactive=true 看全部。
   */
  app.get<{ Params: { code: string } }>('/dicts/:code/items', async (req) => {
    const dictCode = parseDictCode(req.params.code)
    const { includeInactive } = parseOrThrow(DictQuerySchema, req.query)
    return { data: await listDictItems(dictCode, includeInactive) }
  })

  // 维护字典是 MANAGER 及以上（用户管理才是 ADMIN 专属）
  app.post<{ Params: { code: string } }>(
    '/dicts/:code/items',
    { preHandler: requireRole('MANAGER') },
    async (req, reply) => {
      const dictCode = parseDictCode(req.params.code)
      const input = parseOrThrow(DictItemCreateSchema, req.body)
      const created = await createDictItem(dictCode, input, actingUser(req), requestMeta(req))
      reply.code(201)
      return { data: created }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/dict-items/:id',
    { preHandler: requireRole('MANAGER') },
    async (req) => {
      const input = parseOrThrow(DictItemUpdateSchema, req.body)
      return { data: await updateDictItem(req.params.id, input, actingUser(req), requestMeta(req)) }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/dict-items/:id',
    { preHandler: requireRole('MANAGER') },
    async (req) => {
      await deleteDictItem(req.params.id, actingUser(req), requestMeta(req))
      return { data: { ok: true } }
    },
  )
}
