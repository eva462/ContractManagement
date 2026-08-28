import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_VALUES,
  CONTRACT_TYPE_LABEL,
  CONTRACT_TYPE_VALUES,
  DEFAULT_PAGE_SIZE,
  formatAmount,
  type ContractListItem,
  type UserBrief,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { contractApi, userApi } from '../api/resources'
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  ExpiryBadge,
  Input,
  LoadingBlock,
  Select,
  StatusBadge,
  cx,
} from '../components/ui'

/** 参与 URL 的筛选项。放进 URL 才能刷新不丢、也能把某个筛选结果直接发给同事。 */
const FILTER_KEYS = [
  'keyword',
  'status',
  'expiry',
  'contractType',
  'ownerId',
  'signDateFrom',
  'signDateTo',
  'sort',
  'order',
  'page',
] as const

/** 与后端 ContractQuerySchema 的默认值保持一致 */
const DEFAULT_SORT = 'signDate'
const DEFAULT_ORDER = 'desc'

const SORTABLE: { key: string; label: string; align?: 'right' }[] = [
  { key: 'contractNo', label: '合同编号' },
  { key: 'amount', label: '合同金额', align: 'right' },
  { key: 'signDate', label: '签订日期' },
  { key: 'expiryDate', label: '到期日期' },
]

export function ContractListPage(): ReactNode {
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<ContractListItem[]>([])
  const [total, setTotal] = useState(0)
  const [users, setUsers] = useState<UserBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 输入框走本地状态，停止输入 300ms 后才同步到 URL，避免每敲一个字发一次请求
  const [keywordDraft, setKeywordDraft] = useState(params.get('keyword') ?? '')
  const debounceRef = useRef<number | undefined>(undefined)

  const page = Number(params.get('page') ?? '1')
  const sort = params.get('sort') ?? DEFAULT_SORT
  const order = params.get('order') ?? DEFAULT_ORDER

  useEffect(() => {
    document.title = '合同台账 · 合同管理系统'
  }, [])

  const query = useMemo(() => {
    const sp = new URLSearchParams()
    for (const k of FILTER_KEYS) {
      const v = params.get(k)
      if (v) sp.set(k, v)
    }
    sp.set('pageSize', String(DEFAULT_PAGE_SIZE))
    return sp.toString()
  }, [params])

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)

    contractApi
      .list(query, ac.signal)
      .then((res) => {
        setItems(res.data)
        setTotal(res.meta?.total ?? res.data.length)
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        setError(err instanceof ApiError ? err.message : '加载失败')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })

    return () => ac.abort()
  }, [query])

  useEffect(() => {
    const ac = new AbortController()
    userApi
      .list(ac.signal)
      .then((res) => setUsers(res.data))
      .catch(() => {
        /* 经办人下拉拿不到不影响主流程 */
      })
    return () => ac.abort()
  }, [])

  // URL 变化（比如浏览器后退）时把输入框同步回来
  useEffect(() => {
    setKeywordDraft(params.get('keyword') ?? '')
  }, [params])

  /**
   * 基线一律从 window.location.search 取，不要闭包里的 params。
   *
   * 关键词是防抖 300ms 之后才写 URL 的。这 300ms 里用户很可能动了某个下拉，
   * 而防抖回调闭包里的 params 停留在上一次渲染。setParams 的函数式写法也救不了 ——
   * react-router 是把这个函数作用在它自己捕获的 searchParams 上，同样是旧值。
   * 只有地址栏是当下的真值。
   */
  const currentParams = (): URLSearchParams => new URLSearchParams(window.location.search)

  const setFilter = (key: string, value: string): void => {
    const next = currentParams()
    if (value) next.set(key, value)
    else next.delete(key)
    // 改任何筛选条件都要回到第一页，否则会停在一个空页上
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const onKeywordChange = (value: string): void => {
    setKeywordDraft(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setFilter('keyword', value.trim()), 300)
  }

  const toggleSort = (key: string): void => {
    const next = currentParams()
    // 没写进 URL 时用的是默认排序，比较时也要按默认值来，
    // 否则第一次点默认排序列会「没反应」
    if ((next.get('sort') ?? DEFAULT_SORT) === key) {
      next.set('order', (next.get('order') ?? DEFAULT_ORDER) === 'asc' ? 'desc' : 'asc')
    } else {
      next.set('sort', key)
      next.set('order', 'desc')
    }
    next.delete('page')
    setParams(next, { replace: true })
  }

  const activeFilters = FILTER_KEYS.filter(
    (k) => k !== 'sort' && k !== 'order' && k !== 'page' && params.get(k),
  ).length

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-800">合同台账</h1>
          <p className="mt-0.5 text-sm text-slate-600 tabular">
            共 {total} 份合同
            {activeFilters > 0 && ` · ${activeFilters} 个筛选条件生效`}
          </p>
        </div>
        <Link to="/contracts/new">
          <Button variant="primary">新建合同</Button>
        </Link>
      </div>

      <Card bodyClassName="p-3">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="搜合同名称 / 编号 / 对方单位"
            value={keywordDraft}
            onChange={(e) => onKeywordChange(e.target.value)}
            className="lg:col-span-2"
            aria-label="关键词搜索"
          />
          <Select
            value={params.get('status') ?? ''}
            onChange={(e) => setFilter('status', e.target.value)}
            aria-label="按状态筛选"
          >
            <option value="">全部状态</option>
            {CONTRACT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            value={params.get('contractType') ?? ''}
            onChange={(e) => setFilter('contractType', e.target.value)}
            aria-label="按类型筛选"
          >
            <option value="">全部类型</option>
            {CONTRACT_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {CONTRACT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
          <Select
            value={params.get('ownerId') ?? ''}
            onChange={(e) => setFilter('ownerId', e.target.value)}
            aria-label="按经办人筛选"
          >
            <option value="">全部经办人</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
          <Select
            value={params.get('expiry') ?? ''}
            onChange={(e) => setFilter('expiry', e.target.value)}
            aria-label="按到期情况筛选"
          >
            <option value="">全部到期情况</option>
            <option value="EXPIRING">即将到期（30 天内）</option>
            <option value="EXPIRED">已过期</option>
          </Select>
          {/* min-w-0 不能省：flex 子项默认 min-width:auto，
              原生 date 输入框的最小内容宽度会把容器撑破，小屏上整页横向滚动 */}
          <div className="flex items-center gap-2 lg:col-span-2">
            <Input
              type="date"
              value={params.get('signDateFrom') ?? ''}
              onChange={(e) => setFilter('signDateFrom', e.target.value)}
              aria-label="签订日期起"
              className="min-w-0 flex-1"
            />
            <span className="shrink-0 text-sm text-slate-600">至</span>
            <Input
              type="date"
              value={params.get('signDateTo') ?? ''}
              onChange={(e) => setFilter('signDateTo', e.target.value)}
              aria-label="签订日期止"
              className="min-w-0 flex-1"
            />
          </div>
        </div>

        {activeFilters > 0 && (
          <div className="mt-2.5 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
              清空筛选
            </Button>
          </div>
        )}
      </Card>

      {error && <ErrorNotice message={error} />}

      <Card bodyClassName="p-0">
        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState
            title={activeFilters > 0 ? '没有符合条件的合同' : '还没有合同'}
            description={
              activeFilters > 0 ? '试试放宽筛选条件，或清空后重新查找。' : '点右上角「新建合同」开始录入。'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
                  {SORTABLE.slice(0, 1).map((c) => (
                    <SortableTh
                      key={c.key}
                      label={c.label}
                      align={c.align}
                      active={sort === c.key}
                      order={order}
                      onClick={() => toggleSort(c.key)}
                    />
                  ))}
                  <th className="px-3 py-2.5 font-medium">合同名称</th>
                  <th className="px-3 py-2.5 font-medium">类型</th>
                  <th className="px-3 py-2.5 font-medium">对方单位</th>
                  {SORTABLE.slice(1).map((c) => (
                    <SortableTh
                      key={c.key}
                      label={c.label}
                      align={c.align}
                      active={sort === c.key}
                      order={order}
                      onClick={() => toggleSort(c.key)}
                    />
                  ))}
                  <th className="px-3 py-2.5 font-medium">经办人</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-slate-600 tabular">
                      {c.contractNo ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/contracts/${c.id}`}
                        className="font-medium text-slate-800 underline-offset-2 hover:underline"
                      >
                        {c.title}
                      </Link>
                      {c.attachmentCount > 0 && (
                        <span className="ml-1.5 text-xs text-slate-600">
                          {c.attachmentCount} 个附件
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                      {c.contractType ? CONTRACT_TYPE_LABEL[c.contractType] : '—'}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2.5 text-slate-700">
                      {c.counterpartyName ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-slate-800 tabular">
                      {c.amountType === 'NO_AMOUNT' ? (
                        <span className="text-slate-600">无金额</span>
                      ) : (
                        formatAmount(c.amount, c.currency)
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 tabular">
                      {c.signDate ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 tabular">
                      <span className="inline-flex items-center gap-1.5">
                        {c.isPerpetual ? '长期' : (c.expiryDate ?? '—')}
                        <ExpiryBadge state={c.expiryState} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-700">
                      {c.owner?.displayName ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600 tabular">
            第 {page} / {totalPages} 页
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={page <= 1}
              onClick={() => setFilter('page', String(page - 1))}
            >
              上一页
            </Button>
            <Button
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setFilter('page', String(page + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SortableTh({
  label,
  align,
  active,
  order,
  onClick,
}: {
  label: string
  align?: 'right'
  active: boolean
  order: string
  onClick: () => void
}): ReactNode {
  return (
    <th className={cx('px-3 py-2.5 font-medium', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          'inline-flex items-center gap-1 rounded transition-colors hover:text-slate-800',
          active && 'font-semibold text-slate-800',
        )}
      >
        {label}
        <span aria-hidden className={cx('text-[10px]', !active && 'text-slate-300')}>
          {active ? (order === 'asc' ? '▲' : '▼') : '▼'}
        </span>
      </button>
    </th>
  )
}
