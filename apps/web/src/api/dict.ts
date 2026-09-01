import { useCallback, useEffect, useState } from 'react'
import type {
  DictCode,
  DictItemCreateInput,
  DictItemDto,
  DictItemUpdateInput,
} from '@contract/shared'
import { request } from './client'

export const dictApi = {
  /** 默认只返回启用的项（下拉用）；设置页传 includeInactive 看全部 */
  list: (code: DictCode, opts: { includeInactive?: boolean; signal?: AbortSignal } = {}) =>
    request<DictItemDto[]>(
      `/dicts/${code}/items${opts.includeInactive ? '?includeInactive=true' : ''}`,
      { signal: opts.signal },
    ),

  create: (code: DictCode, body: DictItemCreateInput) =>
    request<DictItemDto>(`/dicts/${code}/items`, { method: 'POST', body }),

  update: (id: string, body: DictItemUpdateInput) =>
    request<DictItemDto>(`/dict-items/${id}`, { method: 'PATCH', body }),

  remove: (id: string) => request(`/dict-items/${id}`, { method: 'DELETE' }),
}

/**
 * 读一组字典。下拉框和标签展示都用它，**不要再 import 代码里的常量** ——
 * 那样管理员在设置里新增的项前端就认不到。
 *
 * 默认只拿启用的项：新建合同时不该能选到已停用的类型。
 */
export function useDict(
  code: DictCode,
  opts: { includeInactive?: boolean } = {},
): {
  items: DictItemDto[]
  /** itemCode → 中文名。老合同引用了已停用的项时也能正确显示 */
  labelOf: (itemCode: string | null | undefined) => string
  loading: boolean
  reload: () => void
} {
  const includeInactive = opts.includeInactive ?? false
  const [items, setItems] = useState<DictItemDto[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    dictApi
      .list(code, { includeInactive, signal: ac.signal })
      .then((res) => setItems(res.data))
      .catch(() => {
        /* 拿不到就退化成空下拉，不阻塞整页 */
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [code, includeInactive, tick])

  const labelOf = useCallback(
    (itemCode: string | null | undefined): string => {
      if (!itemCode) return '—'
      return items.find((i) => i.itemCode === itemCode)?.itemLabel ?? itemCode
    },
    [items],
  )

  return { items, labelOf, loading, reload: () => setTick((t) => t + 1) }
}

/**
 * 展示用：把「只拿启用项」的下拉和「历史值可能已停用」调和起来。
 *
 * 合同存的类型如果已被停用，下拉里没有这一项，直接渲染会变成空选项，
 * 用户一保存就把类型弄丢了。所以编辑态要把当前值补进选项里。
 */
export function optionsWithCurrent(
  items: DictItemDto[],
  currentCode: string | null | undefined,
): { value: string; label: string; retired: boolean }[] {
  const base = items.map((i) => ({ value: i.itemCode, label: i.itemLabel, retired: !i.isActive }))
  if (currentCode && !base.some((o) => o.value === currentCode)) {
    base.unshift({ value: currentCode, label: `${currentCode}（已停用）`, retired: true })
  }
  return base
}
