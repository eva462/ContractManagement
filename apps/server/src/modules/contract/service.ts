import {
  CONTRACT_ACTIONS,
  CONTRACT_EDITABLE_FIELDS,
  CONTRACT_STATUS_LABEL,
  CONTRACT_TYPE_PREFIX,
  ErrorCode,
  EXPIRING_SOON_DAYS,
  dateStringToDate,
  dateToDateString,
  todayString,
  validateContractRules,
  type ContractAction,
  type ContractDetail,
  type ContractListItem,
  type ContractQuery,
  type ContractStatus,
  type ContractStatusChangeInput,
  type ContractType,
  type ContractWriteValues,
  type Currency,
} from '@contract/shared'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { AppError, badRequest, conflict, forbidden, notFound, validationFailed } from '../../http/errors.js'
import { describeCreatedFields, describeFieldChanges, diffFields } from '../audit/diff.js'
import { writeAudit } from '../audit/service.js'
import {
  contractDetailInclude,
  contractListInclude,
  decimalToString,
  toDetail,
  toListItem,
  type ContractRow,
} from './mapper.js'
import { canDelete, canEdit, canRunAction } from './permissions.js'
import type { Actor, ActingUser, RequestMeta } from '../../types.js'

/* ── 值的形状转换 ───────────────────────────────────────────────────── */

/** 数据库行 → 与前端提交同构的「业务值」。diff 两边形状一致，比较才可靠。 */
function extractValues(row: ContractRow): Record<string, unknown> {
  return {
    contractNo: row.contractNo,
    title: row.title,
    contractType: row.contractType,
    counterpartyName: row.counterpartyName,
    counterpartyContact: row.counterpartyContact,
    amountType: row.amountType,
    amount: decimalToString(row.amount),
    currency: row.currency,
    paymentTerms: row.paymentTerms,
    signDate: dateToDateString(row.signDate),
    effectiveDate: dateToDateString(row.effectiveDate),
    expiryDate: dateToDateString(row.expiryDate),
    isPerpetual: row.isPerpetual,
    ownerId: row.ownerId,
    originalLocation: row.originalLocation,
    remark: row.remark,
  }
}

const PLAIN_FIELDS = [
  'contractNo',
  'title',
  'contractType',
  'counterpartyName',
  'counterpartyContact',
  'amountType',
  'currency',
  'paymentTerms',
  'isPerpetual',
  'ownerId',
  'originalLocation',
  'remark',
] as const

const DATE_FIELDS = ['signDate', 'effectiveDate', 'expiryDate'] as const

/** 业务值 → Prisma 入参。只在这一层做日期字符串 → Date 的转换。 */
function toPrismaData(v: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const k of PLAIN_FIELDS) if (k in v) data[k] = v[k]
  if ('amount' in v) data.amount = v.amount // Prisma 的 Decimal 直接接受字符串
  for (const k of DATE_FIELDS) {
    if (k in v) data[k] = v[k] ? dateStringToDate(v[k] as string) : null
  }
  return data
}

/* ── 查询 ──────────────────────────────────────────────────────────── */

function buildWhere(q: ContractQuery, actor: Actor): Record<string, unknown> {
  const and: unknown[] = []

  // 可见范围开关。默认 ALL（全员可见全部），改 .env 即可切成只看自己经办的。
  if (env.contractVisibility === 'OWN' && actor.role === 'STAFF') {
    and.push({ ownerId: actor.id })
  }

  if (q.keyword) {
    and.push({
      OR: [
        { title: { contains: q.keyword, mode: 'insensitive' } },
        { contractNo: { contains: q.keyword, mode: 'insensitive' } },
        { counterpartyName: { contains: q.keyword, mode: 'insensitive' } },
      ],
    })
  }
  if (q.status) and.push({ status: q.status })
  if (q.contractType) and.push({ contractType: q.contractType })
  if (q.ownerId) and.push({ ownerId: q.ownerId })
  if (q.signDateFrom) and.push({ signDate: { gte: dateStringToDate(q.signDateFrom) } })
  if (q.signDateTo) and.push({ signDate: { lte: dateStringToDate(q.signDateTo) } })

  // 「已到期 / 即将到期」是派生态，这里翻译成对 expiryDate 的日期查询
  if (q.expiry) {
    const today = dateStringToDate(todayString())
    if (q.expiry === 'EXPIRED') {
      and.push({ status: 'ACTIVE', isPerpetual: false, expiryDate: { lt: today } })
    } else {
      const limit = new Date(today.getTime() + EXPIRING_SOON_DAYS * 86_400_000)
      and.push({ status: 'ACTIVE', isPerpetual: false, expiryDate: { gte: today, lte: limit } })
    }
  }

  return and.length > 0 ? { deletedAt: null, AND: and } : { deletedAt: null }
}

export async function listContracts(
  q: ContractQuery,
  actor: Actor,
): Promise<{ items: ContractListItem[]; total: number }> {
  const where = buildWhere(q, actor)

  // 可空字段排序时把空值排在最后，否则一堆没填到期日的合同会占满第一页
  const primary = { [q.sort]: { sort: q.order, nulls: 'last' } }
  const orderBy = [primary, { createdAt: 'desc' as const }]

  const [items, total] = await Promise.all([
    db.contract.findMany({
      where: where as never,
      include: contractListInclude,
      orderBy: orderBy as never,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.contract.count({ where: where as never }),
  ])

  return { items: items.map((r) => toListItem(r as ContractRow)), total }
}

async function loadContractOrThrow(id: string) {
  const row = await db.contract.findFirst({
    where: { id, deletedAt: null },
    include: contractDetailInclude,
  })
  if (!row) throw notFound(ErrorCode.CONTRACT_NOT_FOUND, '合同不存在或已被删除')
  return row
}

export async function getContractDetail(id: string, actor: Actor): Promise<ContractDetail> {
  const row = await loadContractOrThrow(id)
  return toDetail(row as ContractRow, actor)
}

/* ── 合同编号 ───────────────────────────────────────────────────────── */

/**
 * 编号格式 {类型缩写}-{年份}-{4位流水}，流水按「类型 + 年份」独立自增。
 * 查询刻意不过滤软删除的合同 —— 删掉的编号不应该被重新用掉。
 */
export async function nextContractNo(contractType: ContractType): Promise<string> {
  const prefix = CONTRACT_TYPE_PREFIX[contractType]
  const year = new Date().getFullYear()
  const head = `${prefix}-${year}-`

  const latest = await db.contract.findFirst({
    where: { contractNo: { startsWith: head } },
    select: { contractNo: true },
    orderBy: { contractNo: 'desc' },
  })

  const lastSeq = latest?.contractNo ? Number(latest.contractNo.slice(head.length)) : 0
  const next = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1
  return `${head}${String(next).padStart(4, '0')}`
}

async function assertContractNoAvailable(no: unknown, excludeId: string | null): Promise<void> {
  if (!no || typeof no !== 'string') return
  const existing = await db.contract.findFirst({
    where: { contractNo: no, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  })
  if (existing) {
    throw conflict(ErrorCode.CONTRACT_NO_DUPLICATED, '合同编号已存在', [
      { field: 'contractNo', message: '该合同编号已被占用，请换一个或点「自动生成」' },
    ])
  }
}

async function assertOwnerExists(ownerId: unknown): Promise<void> {
  if (!ownerId || typeof ownerId !== 'string') return
  const user = await db.user.findFirst({ where: { id: ownerId, isActive: true }, select: { id: true } })
  if (!user) {
    throw validationFailed([{ field: 'ownerId', message: '经办人不存在或已停用' }])
  }
}

/* ── 写入 ──────────────────────────────────────────────────────────── */

export async function createContract(
  input: ContractWriteValues & { activate: boolean },
  actor: ActingUser,
  meta: RequestMeta,
): Promise<ContractDetail> {
  const { activate, ...rest } = input
  const values: Record<string, unknown> = { ...rest, ownerId: rest.ownerId ?? actor.id }

  const issues = validateContractRules(values as Partial<ContractWriteValues>, { strict: activate })
  if (issues.length > 0) {
    // 提交生效时字段不全，用专门的错误码，前端好把「还差哪些」单独展示
    if (activate) {
      throw new AppError(
        ErrorCode.INCOMPLETE_FOR_ACTIVATION,
        '以下字段还没填完，不能提交生效',
        400,
        issues,
      )
    }
    throw validationFailed(issues)
  }

  await assertOwnerExists(values.ownerId)
  await assertContractNoAvailable(values.contractNo, null)

  const status: ContractStatus = activate ? 'ACTIVE' : 'DRAFT'

  return db.$transaction(async (tx) => {
    const created = await tx.contract.create({
      data: {
        ...toPrismaData(values),
        status,
        createdById: actor.id,
        updatedById: actor.id,
      } as never,
      include: contractDetailInclude,
    })

    const changes = diffFields(null, values, CONTRACT_EDITABLE_FIELDS)
    const filled = describeCreatedFields(changes)

    await writeAudit(tx, {
      entityType: 'CONTRACT',
      entityId: created.id,
      action: 'CREATE',
      userId: actor.id,
      userName: actor.displayName,
      summary:
        `${actor.displayName} 创建了合同「${created.title}」（${CONTRACT_STATUS_LABEL[status]}）` +
        (filled ? `，填写了 ${filled}` : ''),
      changes,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    return toDetail(created as ContractRow, actor)
  })
}

export async function updateContract(
  id: string,
  input: Partial<ContractWriteValues>,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<ContractDetail> {
  const existing = await loadContractOrThrow(id)
  const subject = { ownerId: existing.ownerId, status: existing.status as ContractStatus }

  if (!canEdit(actor, subject)) {
    if (subject.status === 'ARCHIVED') {
      throw new AppError(
        ErrorCode.CONTRACT_READONLY,
        '合同已归档，处于只读状态。如需修改请先解除归档。',
        409,
      )
    }
    throw forbidden('只能编辑自己经办的合同')
  }

  const before = extractValues(existing as ContractRow)
  const merged = { ...before, ...input }

  // 已生效的合同不允许改成「缺必填」的状态；草稿则宽松
  const strict = subject.status !== 'DRAFT'
  const issues = validateContractRules(merged as Partial<ContractWriteValues>, { strict })
  if (issues.length > 0) throw validationFailed(issues)

  if ('ownerId' in input) await assertOwnerExists(merged.ownerId)
  if ('contractNo' in input && merged.contractNo !== before.contractNo) {
    await assertContractNoAvailable(merged.contractNo, id)
  }

  const changes = diffFields(before, merged, CONTRACT_EDITABLE_FIELDS)

  // 什么都没改就不写留痕。留痕里全是空记录会让真正的改动淹没掉。
  if (Object.keys(changes).length === 0) {
    return toDetail(existing as ContractRow, actor)
  }

  // 经办人变更要把 id 翻成人名，且在写入时定死 —— 之后改显示名不影响这条历史
  const names: Record<string, string> = {}
  if (changes.ownerId) {
    const ids = [changes.ownerId.before, changes.ownerId.after].filter(
      (v): v is string => typeof v === 'string',
    )
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    })
    for (const u of users) names[u.id] = u.displayName
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.contract.update({
      where: { id },
      data: { ...toPrismaData(input as Record<string, unknown>), updatedById: actor.id } as never,
      include: contractDetailInclude,
    })

    await writeAudit(tx, {
      entityType: 'CONTRACT',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} ${describeFieldChanges(changes, {
        currency: (merged.currency as Currency) ?? 'CNY',
        names,
      })}`,
      changes,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    return toDetail(updated as ContractRow, actor)
  })
}

export async function deleteContract(
  id: string,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<void> {
  const existing = await loadContractOrThrow(id)
  const subject = { ownerId: existing.ownerId, status: existing.status as ContractStatus }

  if (!canDelete(actor, subject)) {
    if (subject.status !== 'DRAFT') {
      throw badRequest(
        ErrorCode.CONTRACT_NOT_DELETABLE,
        `「${CONTRACT_STATUS_LABEL[subject.status]}」的合同不能删除，只能归档`,
      )
    }
    throw forbidden('只能删除自己经办的草稿')
  }

  await db.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actor.id },
    })
    await writeAudit(tx, {
      entityType: 'CONTRACT',
      entityId: id,
      action: 'DELETE',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} 删除了草稿合同「${existing.title}」`,
      changes: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
  })
}

/* ── 状态流转 ───────────────────────────────────────────────────────── */

export async function changeContractStatus(
  id: string,
  input: ContractStatusChangeInput & { action: ContractAction },
  actor: ActingUser,
  meta: RequestMeta,
): Promise<ContractDetail> {
  const existing = await loadContractOrThrow(id)
  const from = existing.status as ContractStatus
  const subject = { ownerId: existing.ownerId, status: from }
  const def = CONTRACT_ACTIONS[input.action]

  if (!def.from.includes(from)) {
    throw badRequest(
      ErrorCode.ILLEGAL_TRANSITION,
      `当前状态「${CONTRACT_STATUS_LABEL[from]}」不能执行「${def.label}」`,
    )
  }
  if (!canRunAction(actor, subject, input.action)) {
    throw forbidden(`没有权限执行「${def.label}」`)
  }

  if (def.requiresComplete) {
    const issues = validateContractRules(
      extractValues(existing as ContractRow) as Partial<ContractWriteValues>,
      { strict: true },
    )
    if (issues.length > 0) {
      throw new AppError(
        ErrorCode.INCOMPLETE_FOR_ACTIVATION,
        '以下字段还没填完，不能提交生效',
        400,
        issues,
      )
    }
  }

  // to 为 null 表示「回到归档前的状态」
  const target: ContractStatus =
    def.to ?? ((existing.archivedFrom as ContractStatus | null) ?? 'ACTIVE')

  const data: Record<string, unknown> = { status: target, updatedById: actor.id }
  const changes: Record<string, { before: unknown; after: unknown }> = {
    status: { before: from, after: target },
  }

  if (input.action === 'ARCHIVE') {
    data.archivedFrom = from
  }
  if (input.action === 'UNARCHIVE') {
    data.archivedFrom = null
  }
  if (input.action === 'TERMINATE') {
    data.terminatedAt = dateStringToDate(input.terminatedAt as string)
    data.terminationReason = input.terminationReason
    changes.terminatedAt = { before: null, after: input.terminatedAt }
    changes.terminationReason = { before: null, after: input.terminationReason }
  }

  let summary =
    `${actor.displayName} 执行了「${def.label}」，` +
    `状态从 ${CONTRACT_STATUS_LABEL[from]} 变为 ${CONTRACT_STATUS_LABEL[target]}`
  if (input.action === 'TERMINATE') {
    summary += `，终止日期 ${input.terminatedAt}，原因：${input.terminationReason}`
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.contract.update({
      where: { id },
      data: data as never,
      include: contractDetailInclude,
    })
    await writeAudit(tx, {
      entityType: 'CONTRACT',
      entityId: id,
      action: 'STATUS_CHANGE',
      userId: actor.id,
      userName: actor.displayName,
      summary,
      changes,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    return toDetail(updated as ContractRow, actor)
  })
}
