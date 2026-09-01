import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  RISK_SEVERITY_LABEL,
  RISK_SEVERITY_VALUES,
  type ReviewRuleDto,
  type RiskSeverity,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { reviewApi } from '../api/resources'
import { ConfirmDialog, Modal, useToast } from './overlays'
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LoadingBlock,
  Select,
  Textarea,
  cx,
} from './ui'

/**
 * 维护 AI 审查要点。
 *
 * 这些要点会**逐条拼进提示词**，所以写得越具体，模型给的结论越可用。
 * 「审查付款条款」这种笼统的写法只会换来一句正确的废话。
 */

const SEVERITY_STYLES: Record<RiskSeverity, string> = {
  HIGH: 'bg-rose-50 text-rose-800 ring-rose-300',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-300',
  LOW: 'bg-sky-50 text-sky-800 ring-sky-300',
}

interface Draft {
  title: string
  detail: string
  severity: RiskSeverity
  sortOrder: string
}

const EMPTY: Draft = { title: '', detail: '', severity: 'MEDIUM', sortOrder: '0' }

export function ReviewRuleSettings(): ReactNode {
  const [rules, setRules] = useState<ReviewRuleDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ReviewRuleDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ReviewRuleDto | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const { data } = await reviewApi.templates(signal)
      // 目前只有一套通用模板。以后按合同类型分模板了，这里要加个选择器。
      const generic = data.find((t) => t.contractType === null) ?? data[0]
      setRules(generic?.rules ?? [])
      setError(null)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof ApiError ? err.message : '加载失败')
      setRules([])
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void reload(ac.signal)
    return () => ac.abort()
  }, [reload])

  const toggleActive = async (rule: ReviewRuleDto): Promise<void> => {
    try {
      await reviewApi.updateRule(rule.id, { isActive: !rule.isActive })
      toast.success(rule.isActive ? '已停用' : '已启用')
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    try {
      await reviewApi.removeRule(deleting.id)
      toast.success('已删除')
      setDeleting(null)
      await reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  const active = rules?.filter((r) => r.isActive).length ?? 0

  return (
    <Card
      title="AI 审查要点"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          新增要点
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        提交审核时，AI 会逐条对照这些要点检查合同，只报<strong>能在原文里找到依据</strong>
        的问题。要点写得越具体越好 —— 「审查付款条款」这种写法只会换来一句正确的废话。
        {rules && (
          <span className="ml-1 text-slate-500">
            （共 {rules.length} 条，启用 {active} 条）
          </span>
        )}
      </p>

      {error && <ErrorNotice message={error} />}

      {!rules ? (
        <LoadingBlock />
      ) : rules.length === 0 ? (
        <EmptyState
          title="还没有审查要点"
          description="加几条之后，提交审核时就会自动跑 AI 审查。"
        />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className={cx('flex flex-wrap gap-3 py-3', !rule.isActive && 'opacity-55')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cx(
                      'rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                      SEVERITY_STYLES[rule.severity],
                    )}
                  >
                    {RISK_SEVERITY_LABEL[rule.severity]}
                  </span>
                  <span className="text-sm font-medium text-slate-900">{rule.title}</span>
                  {rule.isDraft && (
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700 ring-1 ring-violet-200">
                      AI 建议 · 待确认
                    </span>
                  )}
                  {!rule.isActive && (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                      已停用
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{rule.detail}</p>
              </div>

              <div className="flex shrink-0 items-start gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>
                  编辑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleActive(rule)}>
                  {rule.isActive ? '停用' : '启用'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(rule)}>
                  删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RuleModal
        open={creating || editing !== null}
        rule={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          void reload()
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="删除审查要点"
        message={`确定删除「${deleting?.title ?? ''}」？已有的审查记录不受影响 —— 风险点存的是标题快照。`}
        confirmLabel="删除"
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void onDelete()}
      />
    </Card>
  )
}

function RuleModal({
  open,
  rule,
  onClose,
  onSaved,
}: {
  open: boolean
  rule: ReviewRuleDto | null
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const toast = useToast()

  useEffect(() => {
    if (!open) return
    setIssues({})
    setDraft(
      rule
        ? {
            title: rule.title,
            detail: rule.detail,
            severity: rule.severity,
            sortOrder: String(rule.sortOrder),
          }
        : EMPTY,
    )
  }, [open, rule])

  const save = async (): Promise<void> => {
    setBusy(true)
    setIssues({})
    const body = {
      title: draft.title,
      detail: draft.detail,
      severity: draft.severity,
      // 后端是 coerce.number()，但契约类型要求 number —— 在这儿转，别把字符串塞过去
      sortOrder: Number(draft.sortOrder) || 0,
    }
    try {
      // 采纳一条 AI 建议 = 存的同时把 isDraft 置为 false
      if (rule) await reviewApi.updateRule(rule.id, { ...body, isDraft: false })
      else await reviewApi.createRule(body)
      toast.success('已保存')
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.issues.length > 0) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.field, i.message])))
      } else {
        toast.error(err instanceof ApiError ? err.message : '保存失败')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={rule ? '编辑审查要点' : '新增审查要点'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            保存
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="标题" required error={issues.title} hint="会原样显示在风险点上">
          <Input
            value={draft.title}
            invalid={!!issues.title}
            placeholder="例如：付款节奏是否与交付验收挂钩"
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
        </Field>

        <Field
          label="审查要点"
          required
          error={issues.detail}
          hint="这段会直接进提示词。写清楚「看什么、什么情况算有问题」。"
        >
          <Textarea
            rows={5}
            value={draft.detail}
            invalid={!!issues.detail}
            placeholder="例如：检查付款是否全部前置。若在交付或验收之前就要付超过 30%，属于我方资金风险，需指出。"
            onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="风险等级" hint="命中时按这个等级排序展示">
            <Select
              value={draft.severity}
              onChange={(e) =>
                setDraft((d) => ({ ...d, severity: e.target.value as RiskSeverity }))
              }
            >
              {RISK_SEVERITY_VALUES.map((s) => (
                <option key={s} value={s}>
                  {RISK_SEVERITY_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="排序" error={issues.sortOrder} hint="数字小的排前面">
            <Input
              type="number"
              value={draft.sortOrder}
              invalid={!!issues.sortOrder}
              onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
