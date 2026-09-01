import {
  ErrorCode,
  type DictCode,
  type DictItemCreateInput,
  type DictItemDto,
  type DictItemUpdateInput,
} from '@contract/shared'
import { db, type Tx } from '../../db.js'
import { badRequest, conflict, notFound } from '../../http/errors.js'
import { writeAudit } from '../audit/service.js'
import type { ActingUser, RequestMeta } from '../../types.js'

/**
 * 数据字典。把「合同类型」这类原本写死在代码里的枚举挪进数据库，
 * 管理员在设置里自己维护，加一项不用改代码重新部署。
 */

/** 只有合同类型的字典项会被合同表引用，其他分组暂时没有引用方。 */
async function usageCountOf(dictCode: DictCode, itemCode: string): Promise<number> {
  if (dictCode !== 'CONTRACT_TYPE') return 0
  return db.contract.count({ where: { contractType: itemCode, deletedAt: null } })
}

export async function listDictItems(
  dictCode: DictCode,
  includeInactive: boolean,
): Promise<DictItemDto[]> {
  const rows = await db.dictItem.findMany({
    where: { dictCode, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: 'asc' }, { itemCode: 'asc' }],
  })

  // 引用数一次查完，别在循环里逐条 count
  const counts = new Map<string, number>()
  if (dictCode === 'CONTRACT_TYPE' && rows.length > 0) {
    const grouped = await db.contract.groupBy({
      by: ['contractType'],
      where: { contractType: { in: rows.map((r) => r.itemCode) }, deletedAt: null },
      _count: true,
    })
    for (const g of grouped) {
      if (g.contractType) counts.set(g.contractType, g._count)
    }
  }

  return rows.map((r) => ({
    id: r.id,
    dictCode: r.dictCode as DictCode,
    itemCode: r.itemCode,
    itemLabel: r.itemLabel,
    prefix: r.prefix,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    usageCount: counts.get(r.itemCode) ?? 0,
  }))
}

/** itemCode → 中文名。审计摘要和列表展示都要用，查一次缓一批。 */
export async function dictLabelMap(dictCode: DictCode): Promise<Record<string, string>> {
  const rows = await db.dictItem.findMany({
    where: { dictCode },
    select: { itemCode: true, itemLabel: true },
  })
  return Object.fromEntries(rows.map((r) => [r.itemCode, r.itemLabel]))
}

/**
 * 校验一个值是不是有效的字典项。**停用的项不能用于新数据**，
 * 但已经引用了它的老合同不受影响 —— 这正是「只停用不删除」的意义。
 */
export async function assertValidDictItem(
  dictCode: DictCode,
  itemCode: unknown,
  field: string,
): Promise<void> {
  if (itemCode === null || itemCode === undefined || itemCode === '') return
  if (typeof itemCode !== 'string') return

  const item = await db.dictItem.findUnique({
    where: { dictCode_itemCode: { dictCode, itemCode } },
    select: { isActive: true },
  })
  if (!item) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, '选项不存在', [
      { field, message: '这个选项不存在，可能已被管理员删除，请重新选择' },
    ])
  }
  if (!item.isActive) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, '选项已停用', [
      { field, message: '这个选项已被停用，请选择其他选项' },
    ])
  }
}

/** 合同编号前缀。找不到就退回 HT —— 编号生成不该因为字典配置不全而整个失败。 */
export async function contractTypePrefix(itemCode: string): Promise<string> {
  const item = await db.dictItem.findUnique({
    where: { dictCode_itemCode: { dictCode: 'CONTRACT_TYPE', itemCode } },
    select: { prefix: true },
  })
  return item?.prefix?.trim() || 'HT'
}

export async function createDictItem(
  dictCode: DictCode,
  input: DictItemCreateInput,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<DictItemDto> {
  const existing = await db.dictItem.findUnique({
    where: { dictCode_itemCode: { dictCode, itemCode: input.itemCode } },
    select: { id: true },
  })
  if (existing) {
    throw conflict(ErrorCode.VALIDATION_FAILED, '编码已存在', [
      { field: 'itemCode', message: '这个编码已被占用，换一个' },
    ])
  }

  return db.$transaction(async (tx: Tx) => {
    const row = await tx.dictItem.create({
      data: {
        dictCode,
        itemCode: input.itemCode,
        itemLabel: input.itemLabel,
        prefix: input.prefix ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    })
    await writeAudit(tx, {
      entityType: 'DICT',
      entityId: row.id,
      action: 'CREATE',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} 新增了字典项「${row.itemLabel}」（${dictCode} / ${row.itemCode}）`,
      changes: { itemLabel: { before: null, after: row.itemLabel } },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    return {
      id: row.id,
      dictCode,
      itemCode: row.itemCode,
      itemLabel: row.itemLabel,
      prefix: row.prefix,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      usageCount: 0,
    }
  })
}

export async function updateDictItem(
  id: string,
  input: DictItemUpdateInput,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<DictItemDto> {
  const existing = await db.dictItem.findUnique({ where: { id } })
  if (!existing) throw notFound(ErrorCode.VALIDATION_FAILED, '字典项不存在')

  const changes: Record<string, { before: unknown; after: unknown }> = {}
  const data: Record<string, unknown> = {}
  const track = (key: 'itemLabel' | 'prefix' | 'sortOrder' | 'isActive', next: unknown): void => {
    if (next === undefined) return
    const before = existing[key]
    if (before === next) return
    data[key] = next
    changes[key] = { before, after: next }
  }
  track('itemLabel', input.itemLabel)
  track('prefix', input.prefix)
  track('sortOrder', input.sortOrder)
  track('isActive', input.isActive)

  if (Object.keys(data).length === 0) {
    const usage = await usageCountOf(existing.dictCode as DictCode, existing.itemCode)
    return { ...toDto(existing), usageCount: usage }
  }

  return db.$transaction(async (tx: Tx) => {
    const row = await tx.dictItem.update({ where: { id }, data: data as never })
    const parts: string[] = []
    if ('itemLabel' in changes) parts.push(`名称改为「${row.itemLabel}」`)
    if ('prefix' in changes) parts.push(`编号前缀改为「${row.prefix ?? '空'}」`)
    if ('sortOrder' in changes) parts.push(`排序改为 ${row.sortOrder}`)
    if ('isActive' in changes) parts.push(row.isActive ? '重新启用' : '停用')

    await writeAudit(tx, {
      entityType: 'DICT',
      entityId: id,
      action: 'UPDATE',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} 修改了字典项「${existing.itemLabel}」：${parts.join('，')}`,
      changes,
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
    const usage = await usageCountOf(row.dictCode as DictCode, row.itemCode)
    return { ...toDto(row), usageCount: usage }
  })
}

/**
 * 删除。**被引用过的一律不许删，只能停用** —— 删了的话历史合同的类型会变成
 * 一个指向不存在字典项的孤儿值，界面上显示成裸编码，也没法再统计。
 */
export async function deleteDictItem(
  id: string,
  actor: ActingUser,
  meta: RequestMeta,
): Promise<void> {
  const existing = await db.dictItem.findUnique({ where: { id } })
  if (!existing) throw notFound(ErrorCode.VALIDATION_FAILED, '字典项不存在')

  const usage = await usageCountOf(existing.dictCode as DictCode, existing.itemCode)
  if (usage > 0) {
    throw conflict(ErrorCode.VALIDATION_FAILED, '该选项已被使用，不能删除', [
      {
        field: 'itemCode',
        message: `已有 ${usage} 份合同在用这个选项。删除会让它们的类型变成空，请改用「停用」——停用后新建时选不到，老合同照常显示。`,
      },
    ])
  }

  await db.$transaction(async (tx: Tx) => {
    await tx.dictItem.delete({ where: { id } })
    await writeAudit(tx, {
      entityType: 'DICT',
      entityId: id,
      action: 'DELETE',
      userId: actor.id,
      userName: actor.displayName,
      summary: `${actor.displayName} 删除了未被使用的字典项「${existing.itemLabel}」（${existing.dictCode} / ${existing.itemCode}）`,
      changes: { itemLabel: { before: existing.itemLabel, after: null } },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })
  })
}

function toDto(r: {
  id: string
  dictCode: string
  itemCode: string
  itemLabel: string
  prefix: string | null
  sortOrder: number
  isActive: boolean
}): Omit<DictItemDto, 'usageCount'> {
  return {
    id: r.id,
    dictCode: r.dictCode as DictCode,
    itemCode: r.itemCode,
    itemLabel: r.itemLabel,
    prefix: r.prefix,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  }
}
