import { z } from 'zod'

/**
 * 数据字典。把「合同类型」这类原本写死在代码里的枚举挪进数据库，
 * 让管理员在设置里自己维护，加一项不用改代码重新部署。
 */

export const DICT_CODES = ['CONTRACT_TYPE', 'OUR_ENTITY', 'DEPARTMENT'] as const
export type DictCode = (typeof DICT_CODES)[number]

export const DICT_META: Record<
  DictCode,
  { label: string; description: string; hasPrefix: boolean }
> = {
  CONTRACT_TYPE: {
    label: '合同类型',
    description: '新建合同时的类型下拉。每项要配一个编号前缀，合同编号按它生成。',
    hasPrefix: true,
  },
  OUR_ENTITY: {
    label: '我方主体',
    description: '公司的签约主体。有多个主体时在这里维护。',
    hasPrefix: false,
  },
  DEPARTMENT: {
    label: '部门',
    description: '合同的归属部门。',
    hasPrefix: false,
  },
}

export interface DictItemDto {
  id: string
  dictCode: DictCode
  itemCode: string
  itemLabel: string
  /** 仅合同类型有：合同编号前缀（采购 → CG） */
  prefix: string | null
  sortOrder: number
  isActive: boolean
  /** 被多少条合同引用。>0 时不允许删除，只能停用 */
  usageCount: number
}

/**
 * itemCode 是要写进业务表的值，限制成大写字母数字下划线：
 * 允许中文的话，历史数据里会混进各种全角空格和不可见字符，日后极难清理。
 */
const itemCode = z
  .string()
  .trim()
  .min(1, '编码不能为空')
  .max(32, '编码最多 32 个字符')
  .regex(/^[A-Z][A-Z0-9_]*$/, '编码只能用大写字母、数字和下划线，且以字母开头')

const itemLabel = z.string().trim().min(1, '名称不能为空').max(64, '名称最多 64 个字符')

const prefix = z
  .string()
  .trim()
  .max(8, '前缀最多 8 个字符')
  .regex(/^[A-Z]+$/, '前缀只能用大写字母')
  .nullish()
  .transform((v) => v ?? null)

export const DictItemCreateSchema = z.object({
  itemCode,
  itemLabel,
  prefix,
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
})

export const DictItemUpdateSchema = z.object({
  // itemCode 建库后不给改 —— 已有合同存的就是这个值，改了会指向不存在的字典项
  itemLabel: itemLabel.optional(),
  prefix: prefix.optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
})

export type DictItemCreateInput = z.input<typeof DictItemCreateSchema>
export type DictItemUpdateInput = z.input<typeof DictItemUpdateSchema>

export const DictQuerySchema = z.object({
  /** true = 连停用的也返回（设置页用）；默认只返回启用的（下拉用） */
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})
