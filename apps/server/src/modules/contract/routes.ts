import type { FastifyInstance } from 'fastify'
import {
  AuditQuerySchema,
  ContractCreateSchema,
  ContractQuerySchema,
  ContractStatusChangeSchema,
  ContractUpdateSchema,
  NextContractNoQuerySchema,
  type ContractAction,
} from '@contract/shared'
import { currentUser, requestMeta, requireAuth } from '../../auth/guards.js'
import { actorOf } from '../../types.js'
import { db } from '../../db.js'
import { parseOrThrow } from '../../http/validate.js'
import { toAuditDto } from '../audit/service.js'
import {
  changeContractStatus,
  createContract,
  deleteContract,
  getContractDetail,
  listContracts,
  nextContractNo,
  updateContract,
} from './service.js'

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  // 本插件内所有路由都要求登录。行级权限在 service 里另判。
  app.addHook('preHandler', requireAuth)

  app.get('/contracts', async (req) => {
    const query = parseOrThrow(ContractQuerySchema, req.query)
    const { items, total } = await listContracts(query, actorOf(currentUser(req)))
    return {
      data: items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    }
  })

  // 必须放在 /contracts/:id 之前注册，否则 "next-no" 会被当成 id
  app.get('/contracts/next-no', async (req) => {
    const query = parseOrThrow(NextContractNoQuerySchema, req.query)
    return { data: { contractNo: await nextContractNo(query.contractType) } }
  })

  app.post('/contracts', async (req, reply) => {
    const body = parseOrThrow(ContractCreateSchema, req.body)
    const detail = await createContract(body, actorOf(currentUser(req)), requestMeta(req))
    reply.code(201)
    return { data: detail }
  })

  app.get('/contracts/:id', async (req) => {
    const { id } = req.params as { id: string }
    return { data: await getContractDetail(id, actorOf(currentUser(req))) }
  })

  app.patch('/contracts/:id', async (req) => {
    const { id } = req.params as { id: string }
    const body = parseOrThrow(ContractUpdateSchema, req.body)
    return { data: await updateContract(id, body, actorOf(currentUser(req)), requestMeta(req)) }
  })

  app.delete('/contracts/:id', async (req) => {
    const { id } = req.params as { id: string }
    await deleteContract(id, actorOf(currentUser(req)), requestMeta(req))
    return { data: { ok: true } }
  })

  app.post('/contracts/:id/status', async (req) => {
    const { id } = req.params as { id: string }
    const body = parseOrThrow(ContractStatusChangeSchema, req.body)
    return {
      data: await changeContractStatus(
        id,
        body as typeof body & { action: ContractAction },
        actorOf(currentUser(req)),
        requestMeta(req),
      ),
    }
  })

  app.get('/contracts/:id/audit-logs', async (req) => {
    const { id } = req.params as { id: string }
    const query = parseOrThrow(AuditQuerySchema, req.query)

    // 先确认这条合同当前用户看得到，再给留痕，避免用留痕接口探测合同是否存在
    await getContractDetail(id, actorOf(currentUser(req)))

    const where = { entityType: 'CONTRACT' as const, entityId: id }
    const [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.auditLog.count({ where }),
    ])

    return {
      data: rows.map(toAuditDto),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    }
  })
}
