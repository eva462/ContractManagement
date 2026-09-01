import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AMOUNT_TYPE_LABEL,
  CONTRACT_STATUS_LABEL,
  CURRENCY_LABEL,
  formatAmount,
  todayString,
  type ContractAction,
  type ContractDetail,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { useDict } from '../api/dict'
import { contractApi } from '../api/resources'
import { AttachmentPanel } from '../components/AttachmentPanel'
import { AuditTimeline } from '../components/AuditTimeline'
import { ConfirmDialog, Modal, useToast } from '../components/overlays'
import {
  Button,
  Card,
  ErrorNotice,
  ExpiryBadge,
  Field,
  Input,
  LoadingBlock,
  StatusBadge,
  Textarea,
} from '../components/ui'

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="text-sm text-slate-800">{children ?? <span className="text-slate-400">—</span>}</dd>
    </div>
  )
}

const dash = (v: string | null | undefined): ReactNode =>
  v ? v : <span className="text-slate-400">—</span>

export function ContractDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const [contract, setContract] = useState<ContractDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [confirmAction, setConfirmAction] = useState<{ action: ContractAction; label: string; confirm: string; danger: boolean } | null>(null)
  // 需要额外填内容的动作（驳回要意见、登记签署要日期、终止要原因和日期）
  // 共用一个弹窗，字段由动作定义驱动，不给每个动作写一个专属弹窗。
  type PendingAction = ContractDetail['permissions']['actions'][number]
  const [inputAction, setInputAction] = useState<PendingAction | null>(null)
  const [actionForm, setActionForm] = useState({ comment: '', signedDate: '', reason: '', date: '' })
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // 展示历史值，所以连停用的字典项也要拿 —— 否则老合同的类型会显示成裸编码
  const { labelOf: typeLabel } = useDict('CONTRACT_TYPE', { includeInactive: true })
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!id) return
      contractApi
        .detail(id, signal)
        .then((res) => {
          setContract(res.data)
          setError(null)
        })
        .catch((err) => {
          if (signal?.aborted) return
          setError(err instanceof ApiError ? err.message : '加载失败')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [id],
  )

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  useEffect(() => {
    document.title = contract ? `${contract.title} · 合同管理系统` : '合同详情 · 合同管理系统'
  }, [contract])

  const runAction = async (action: ContractAction, extra?: Record<string, unknown>): Promise<void> => {
    if (!id) return
    setBusy(true)
    try {
      const { data } = await contractApi.changeStatus(id, { action, ...extra })
      setContract(data)
      setRefreshKey((k) => k + 1)
      setConfirmAction(null)
      setInputAction(null)
      setActionForm({ comment: '', signedDate: '', reason: '', date: '' })
      setActionErrors({})
      toast.success('操作完成')
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors()
        // 后端返回的字段级错误映射回弹窗里的输入框
        const toFormField: Record<string, string> = {
          terminationReason: 'reason',
          terminatedAt: 'date',
          signedDate: 'signedDate',
          comment: 'comment',
        }
        const mapped = Object.fromEntries(
          Object.entries(fields)
            .filter(([k]) => k in toFormField)
            .map(([k, v]) => [toFormField[k], v]),
        )
        if (Object.keys(mapped).length > 0) {
          setActionErrors(mapped)
        } else if (err.code === 'INCOMPLETE_FOR_ACTIVATION') {
          // 提交审核缺字段：把缺的列出来，并指路去编辑页补
          toast.error(`${err.message}：${err.issues.map((i) => i.message).join('；')}`)
          setConfirmAction(null)
        } else {
          toast.error(err.message)
          setConfirmAction(null)
        }
      } else {
        toast.error('操作失败')
      }
    } finally {
      setBusy(false)
    }
  }

  const onActionClick = (a: PendingAction): void => {
    if (a.needsReason || a.needsSignedDate) {
      setActionForm({ comment: '', signedDate: todayString(), reason: '', date: todayString() })
      setActionErrors({})
      setInputAction(a)
      return
    }
    if (a.confirm) {
      setConfirmAction({ action: a.action, label: a.label, confirm: a.confirm, danger: a.danger })
      return
    }
    void runAction(a.action)
  }

  const onDelete = async (): Promise<void> => {
    if (!id) return
    setBusy(true)
    try {
      await contractApi.remove(id)
      toast.success('草稿已删除')
      navigate('/contracts')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  const submitInputAction = (): void => {
    if (!inputAction) return
    const errs: Record<string, string> = {}
    const payload: Record<string, string> = {}

    if (inputAction.action === 'TERMINATE') {
      if (!actionForm.reason.trim()) errs.reason = '终止原因不能为空'
      if (!actionForm.date) errs.date = '终止日期不能为空'
      payload.terminationReason = actionForm.reason.trim()
      payload.terminatedAt = actionForm.date
    } else if (inputAction.action === 'REJECT') {
      if (!actionForm.comment.trim()) errs.comment = '请写明驳回原因，否则经办人不知道该改什么'
      payload.comment = actionForm.comment.trim()
    } else if (inputAction.needsSignedDate) {
      if (!actionForm.signedDate) errs.signedDate = '签署日期不能为空'
      payload.signedDate = actionForm.signedDate
      if (actionForm.comment.trim()) payload.comment = actionForm.comment.trim()
    }

    if (Object.keys(errs).length > 0) {
      setActionErrors(errs)
      return
    }
    void runAction(inputAction.action, payload)
  }

  if (loading) return <LoadingBlock />
  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNotice message={error} />
        <div>
          <Link to="/contracts">
            <Button>返回台账</Button>
          </Link>
        </div>
      </div>
    )
  }
  if (!contract) return null

  const p = contract.permissions
  const readonlyNotice = contract.status === 'CLOSED'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/contracts" className="text-sm text-slate-600 hover:text-slate-800">
              合同台账
            </Link>
            <span className="text-slate-300">/</span>
            <span className="font-mono text-xs text-slate-600 tabular">
              {contract.contractNo ?? '未编号'}
            </span>
          </div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-800">
            {contract.title}
            <StatusBadge status={contract.status} />
            <ExpiryBadge state={contract.expiryState} />
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {p.canEdit && (
            <Link to={`/contracts/${contract.id}/edit`}>
              <Button>编辑</Button>
            </Link>
          )}
          {p.actions.map((a) => (
            <Button
              key={a.action}
              variant={a.danger ? 'danger' : 'primary'}
              onClick={() => onActionClick(a)}
              disabled={busy}
            >
              {a.label}
            </Button>
          ))}
          {p.canDelete && (
            <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setConfirmDelete(true)}>
              删除
            </Button>
          )}
        </div>
      </div>

      {readonlyNotice && (
        <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          该合同已归档，处于只读状态。字段、附件都不能再改，需要修改请由系统管理员先「解除归档」。
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card title="基础信息" bodyClassName="px-4 py-1">
            <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
              <Row label="合同编号">
                <span className="font-mono tabular">{dash(contract.contractNo)}</span>
              </Row>
              <Row label="合同类型">
                {contract.contractType ? typeLabel(contract.contractType) : null}
              </Row>
              <Row label="对方单位">{dash(contract.counterpartyName)}</Row>
              <Row label="对方联系人">{dash(contract.counterpartyContact)}</Row>
            </dl>
          </Card>

          <Card title="金额与结算" bodyClassName="px-4 py-1">
            <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
              <Row label="金额类型">
                {contract.amountType ? AMOUNT_TYPE_LABEL[contract.amountType] : null}
              </Row>
              <Row label="合同金额">
                {contract.amountType === 'NO_AMOUNT' ? (
                  <span className="text-slate-600">无金额</span>
                ) : (
                  <span className="font-medium tabular">
                    {formatAmount(contract.amount, contract.currency)}
                  </span>
                )}
              </Row>
              <Row label="币种">{CURRENCY_LABEL[contract.currency]}</Row>
              <Row label="付款结算方式">
                {contract.paymentTerms ? (
                  <span className="whitespace-pre-wrap">{contract.paymentTerms}</span>
                ) : null}
              </Row>
            </dl>
          </Card>

          <Card title="日期与期限" bodyClassName="px-4 py-1">
            <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
              <Row label="签订日期">
                <span className="tabular">{dash(contract.signDate)}</span>
              </Row>
              <Row label="生效日期">
                <span className="tabular">{dash(contract.effectiveDate)}</span>
              </Row>
              <Row label="到期日期">
                {contract.isPerpetual ? (
                  <span className="text-sky-700">长期有效</span>
                ) : (
                  <span className="tabular">{dash(contract.expiryDate)}</span>
                )}
              </Row>
              {contract.status === 'TERMINATED' && (
                <>
                  <Row label="终止日期">
                    <span className="tabular">{dash(contract.terminatedAt)}</span>
                  </Row>
                  <Row label="终止原因">
                    <span className="whitespace-pre-wrap">{dash(contract.terminationReason)}</span>
                  </Row>
                </>
              )}
            </dl>
          </Card>

          <Card title="内部管理" bodyClassName="px-4 py-1">
            <dl className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
              <Row label="经办人">{dash(contract.owner?.displayName)}</Row>
              <Row label="状态">{CONTRACT_STATUS_LABEL[contract.status]}</Row>
              <Row label="原件存放位置">{dash(contract.originalLocation)}</Row>
              <Row label="备注">
                {contract.remark ? <span className="whitespace-pre-wrap">{contract.remark}</span> : null}
              </Row>
              <Row label="创建">
                <span className="text-slate-600 tabular">
                  {contract.createdBy?.displayName ?? '—'} · {contract.createdAt.slice(0, 10)}
                </span>
              </Row>
              <Row label="最后修改">
                <span className="text-slate-600 tabular">
                  {contract.updatedBy?.displayName ?? '—'} · {contract.updatedAt.slice(0, 10)}
                </span>
              </Row>
            </dl>
          </Card>

          <AttachmentPanel
            contractId={contract.id}
            canUpload={p.canUploadAttachment}
            canDelete={p.canDeleteAttachment}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        </div>

        <div className="lg:col-span-1">
          <AuditTimeline
            contractId={contract.id}
            currency={contract.currency}
            refreshKey={refreshKey}
          />
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.label ?? ''}
        message={confirmAction?.confirm ?? ''}
        confirmLabel={confirmAction?.label}
        danger={confirmAction?.danger}
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && void runAction(confirmAction.action)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="删除草稿"
        message={`确定删除草稿「${contract.title}」？删除后台账里不再显示，此操作会记入操作留痕。`}
        confirmLabel="删除"
        danger
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void onDelete()}
      />

      <Modal
        open={inputAction !== null}
        title={inputAction?.label ?? ''}
        onClose={() => setInputAction(null)}
        footer={
          <>
            <Button onClick={() => setInputAction(null)} disabled={busy}>
              取消
            </Button>
            <Button
              variant={inputAction?.danger ? 'danger' : 'primary'}
              onClick={submitInputAction}
              loading={busy}
            >
              确认{inputAction?.label ?? ''}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {inputAction?.action === 'TERMINATE' && (
            <>
              <p className="text-sm text-slate-700">
                终止后合同状态变为「已终止」，终止日期和原因都会写进操作留痕。
              </p>
              <Field label="终止日期" required error={actionErrors.date} htmlFor="terminatedAt">
                <Input
                  id="terminatedAt"
                  type="date"
                  value={actionForm.date}
                  invalid={!!actionErrors.date}
                  onChange={(e) => setActionForm((f) => ({ ...f, date: e.target.value }))}
                  className="tabular"
                />
              </Field>
              <Field label="终止原因" required error={actionErrors.reason} htmlFor="terminationReason">
                <Textarea
                  id="terminationReason"
                  rows={3}
                  value={actionForm.reason}
                  invalid={!!actionErrors.reason}
                  onChange={(e) => setActionForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="如：对方违约，双方协商一致提前解除"
                />
              </Field>
            </>
          )}

          {inputAction?.action === 'REJECT' && (
            <>
              <p className="text-sm text-slate-700">
                驳回后合同回到草稿状态，经办人可以修改后重新提交。你的意见会写进操作留痕。
              </p>
              <Field label="驳回意见" required error={actionErrors.comment} htmlFor="rejectComment">
                <Textarea
                  id="rejectComment"
                  rows={3}
                  value={actionForm.comment}
                  invalid={!!actionErrors.comment}
                  onChange={(e) => setActionForm((f) => ({ ...f, comment: e.target.value }))}
                  placeholder="写明哪里需要改，例如：金额与预算不符，请核对后重报"
                />
              </Field>
            </>
          )}

          {inputAction?.needsSignedDate && (
            <>
              <p className="text-sm text-slate-700">
                登记线下纸面签署完成的日期。登记后合同转入「待归档」，
                需要上传签署后的扫描件并填写原件存放位置，才能正式生效。
              </p>
              <Field label="签署日期" required error={actionErrors.signedDate} htmlFor="signedDate">
                <Input
                  id="signedDate"
                  type="date"
                  value={actionForm.signedDate}
                  invalid={!!actionErrors.signedDate}
                  onChange={(e) => setActionForm((f) => ({ ...f, signedDate: e.target.value }))}
                  className="tabular"
                />
              </Field>
              <Field label="备注" hint="可不填" htmlFor="signComment">
                <Textarea
                  id="signComment"
                  rows={2}
                  value={actionForm.comment}
                  onChange={(e) => setActionForm((f) => ({ ...f, comment: e.target.value }))}
                  placeholder="如：双方已用印，原件一式两份"
                />
              </Field>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
