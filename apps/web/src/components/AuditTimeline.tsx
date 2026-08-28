import { useEffect, useState, type ReactNode } from 'react'
import {
  AUDIT_ACTION_LABEL,
  CONTRACT_FIELD_LABEL,
  formatContractFieldValue,
  type AuditAction,
  type AuditLogDto,
  type Currency,
} from '@contract/shared'
import { contractApi } from '../api/resources'
import { Card, EmptyState, Spinner, cx } from './ui'

const ACTION_DOT: Record<AuditAction, string> = {
  CREATE: 'bg-emerald-500',
  UPDATE: 'bg-sky-500',
  STATUS_CHANGE: 'bg-violet-500',
  DELETE: 'bg-rose-500',
  UPLOAD: 'bg-teal-500',
  DOWNLOAD: 'bg-slate-400',
  LOGIN: 'bg-slate-400',
  LOGIN_FAILED: 'bg-rose-400',
  EXTRACT: 'bg-indigo-500',
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 附件类变更存的是对象，跟字段级 diff 不是一回事，单独渲染。 */
function renderValue(field: string, value: unknown, currency: Currency): string {
  if (value === null || value === undefined) return '空'
  if (typeof value === 'object') {
    const o = value as { fileName?: string }
    return o.fileName ?? JSON.stringify(value)
  }
  return formatContractFieldValue(field, value, { currency })
}

export function AuditTimeline({
  contractId,
  currency,
  refreshKey,
}: {
  contractId: string
  currency: Currency
  refreshKey: number
}): ReactNode {
  const [logs, setLogs] = useState<AuditLogDto[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    contractApi
      .auditLogs(contractId, ac.signal)
      .then((res) => setLogs(res.data))
      .catch(() => {
        /* 留痕加载失败不影响正文 */
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [contractId, refreshKey])

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card title={`操作留痕${logs.length > 0 ? `（${logs.length}）` : ''}`}>
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-slate-400" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState title="暂无操作记录" />
      ) : (
        <ol className="flex flex-col">
          {logs.map((log, idx) => {
            const changes = log.changes ? Object.entries(log.changes) : []
            const open = expanded.has(log.id)
            return (
              <li key={log.id} className="relative flex gap-3 pb-4 last:pb-0">
                {/* 竖线连起时间线，最后一条不画 */}
                {idx < logs.length - 1 && (
                  <span className="absolute top-4 bottom-0 left-[5px] w-px bg-slate-200" aria-hidden />
                )}
                <span
                  className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', ACTION_DOT[log.action])}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                      {AUDIT_ACTION_LABEL[log.action]}
                    </span>
                    <time className="text-xs text-slate-600 tabular">{formatTime(log.createdAt)}</time>
                    {log.ip && <span className="text-xs text-slate-300 tabular">{log.ip}</span>}
                  </div>

                  <p className="mt-1 text-sm leading-relaxed text-slate-700">{log.summary}</p>

                  {changes.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggle(log.id)}
                        className="mt-1 text-xs text-slate-600 underline-offset-2 hover:text-slate-800 hover:underline"
                      >
                        {open ? '收起' : `展开 ${changes.length} 项字段变化`}
                      </button>

                      {open && (
                        <dl className="mt-2 overflow-hidden rounded-md ring-1 ring-slate-200">
                          {changes.map(([field, change], i) => (
                            <div
                              key={field}
                              className={cx(
                                'grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-3 py-2 text-xs sm:grid-cols-[7rem_1fr]',
                                i % 2 === 1 && 'bg-slate-50',
                              )}
                            >
                              <dt className="font-medium text-slate-700">
                                {CONTRACT_FIELD_LABEL[field] ?? field}
                              </dt>
                              <dd className="flex flex-wrap items-center gap-1.5 text-slate-700">
                                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through decoration-rose-300">
                                  {renderValue(field, change.before, currency)}
                                </span>
                                <span className="text-slate-400" aria-label="改为">
                                  →
                                </span>
                                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                                  {renderValue(field, change.after, currency)}
                                </span>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
