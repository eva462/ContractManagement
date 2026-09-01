import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  RISK_SEVERITY_LABEL,
  type ContractReviewDto,
  type RiskSeverity,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { reviewApi } from '../api/resources'
import { useToast } from './overlays'
import { Button, Card, EmptyState, ErrorNotice, LoadingBlock, cx } from './ui'

/**
 * 合同风险审查结果。
 *
 * **只是给审核人看的辅助材料，不阻断任何流转。** 所以这里没有任何按钮会
 * 改变合同状态 —— 最多是重跑一次审查。
 */

const SEVERITY_STYLES: Record<RiskSeverity, string> = {
  HIGH: 'bg-rose-50 text-rose-800 ring-rose-300',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-300',
  LOW: 'bg-sky-50 text-sky-800 ring-sky-300',
}

export function ReviewPanel({
  contractId,
  canRerun,
}: {
  contractId: string
  /** MANAGER 及以上才能手动重跑 */
  canRerun: boolean
}): ReactNode {
  const [review, setReview] = useState<ContractReviewDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [rerunning, setRerunning] = useState(false)
  const toast = useToast()
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal): Promise<ContractReviewDto | null> => {
      try {
        const { data } = await reviewApi.latest(contractId, signal)
        setReview(data)
        return data
      } catch {
        // 拿不到审查结果不该影响详情页其余部分
        return null
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [contractId],
  )

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal).then((first) => {
      // 提交审核后审查在后台跑，打开页面时可能还没好 —— 轮询到出结果为止。
      // 只在 RUNNING 时轮询，不会一直空转。
      const tick = async (): Promise<void> => {
        if (ac.signal.aborted) return
        const d = await load(ac.signal)
        if (d?.status === 'RUNNING') pollRef.current = setTimeout(() => void tick(), 4000)
      }
      if (first?.status === 'RUNNING') pollRef.current = setTimeout(() => void tick(), 4000)
    })
    return () => {
      ac.abort()
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [load])

  const rerun = async (): Promise<void> => {
    setRerunning(true)
    try {
      const { data } = await reviewApi.run(contractId)
      setReview(data)
      toast.success(data.status === 'DONE' ? '审查完成' : '审查未完成')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '审查失败')
    } finally {
      setRerunning(false)
    }
  }

  const action = canRerun ? (
    <Button size="sm" onClick={() => void rerun()} loading={rerunning}>
      {review ? '重新审查' : 'AI 审查'}
    </Button>
  ) : undefined

  return (
    <Card title="AI 风险审查" actions={action}>
      {/*
        审查要把合同正文发给第三方模型。这个系统里「涂抹」是明确的安全边界，
        那就不能让用户以为审查是在本地跑的 —— 说清楚，让人自己决定要不要点。
      */}
      <p className="mb-3 text-xs text-slate-600">
        审查会把<strong>合同正本的文字内容</strong>发给 AI 服务商处理。涉密合同请先涂抹再上传正本，
        或直接跳过 AI 审查走人工。
      </p>

      {loading ? (
        <LoadingBlock />
      ) : !review ? (
        <EmptyState
          title="还没有审查过"
          description={
            canRerun
              ? '提交审核时会自动跑一次；也可以点右上角手动审查。需要合同正本附件是带文字的 PDF —— 扫描件目前审不了。'
              : '提交审核时会自动跑一次。需要合同正本附件是带文字的 PDF。'
          }
        />
      ) : review.status === 'RUNNING' ? (
        <div className="flex flex-col gap-2">
          <LoadingBlock label="AI 正在审查合同…通常需要 30–60 秒" />
          <p className="text-center text-xs text-slate-600">
            审查在后台进行，不影响你做别的操作。审完这里会自动刷新。
          </p>
        </div>
      ) : review.status === 'FAILED' ? (
        <div className="flex flex-col gap-3">
          <ErrorNotice tone="warning" message={review.error ?? '审查失败'} />
          <p className="text-xs text-slate-600">
            审查失败不影响合同流转 —— 它只是辅助材料，照常人工审核即可。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Meta review={review} />

          {review.findings.length === 0 ? (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
              按当前审查要点没有发现问题。
              <span className="mt-0.5 block text-xs text-emerald-700/90">
                这不等于合同没有风险 —— 只说明它没命中现有的规则。仍需人工审核。
              </span>
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {review.findings.map((f) => (
                <li
                  key={f.id}
                  className="rounded-md bg-white p-3 ring-1 ring-slate-200"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cx(
                        'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                        SEVERITY_STYLES[f.severity],
                      )}
                    >
                      {RISK_SEVERITY_LABEL[f.severity]}风险
                    </span>
                    <span className="text-sm font-medium text-slate-900">{f.ruleTitle}</span>
                  </div>

                  <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{f.summary}</p>

                  {/* 原文依据是这套东西可信的关键 —— 没有它的风险点根本不会入库 */}
                  <blockquote className="mt-2 border-l-2 border-slate-300 bg-slate-50 py-1.5 pr-2 pl-3 text-xs leading-relaxed text-slate-700">
                    合同原文：{f.evidence}
                  </blockquote>

                  {f.suggestion && (
                    <p className="mt-2 text-xs text-slate-700">
                      <span className="font-medium">建议：</span>
                      {f.suggestion}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          <p className="border-t border-slate-200 pt-2 text-xs text-slate-600">
            以上是 AI 按审查要点给出的<strong>参考意见，不替代人工审核</strong>，也不影响合同流转。
            每条依据都已回原文核对过，找不到出处的已被丢弃；仍请对照原件复核。
            审查要点可以在设置里调整。
          </p>
        </div>
      )}
    </Card>
  )
}

function Meta({ review }: { review: ContractReviewDto }): ReactNode {
  const time = new Date(review.finishedAt ?? review.createdAt)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <p className="text-xs text-slate-600 tabular">
      {`${time.getFullYear()}-${p(time.getMonth() + 1)}-${p(time.getDate())} ${p(time.getHours())}:${p(time.getMinutes())}`}
      {review.model && ` · ${review.model}`}
      {review.elapsedMs !== null && ` · ${(review.elapsedMs / 1000).toFixed(0)} 秒`}
      {review.createdByName && ` · 由 ${review.createdByName} 触发`}
      {review.redactedCount > 0 && (
        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 ring-1 ring-amber-200">
          本次审查未包含被涂抹的 {review.redactedCount} 处内容
        </span>
      )}
    </p>
  )
}
