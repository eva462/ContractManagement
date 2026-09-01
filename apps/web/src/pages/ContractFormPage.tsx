import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AMOUNT_TYPE_LABEL,
  AMOUNT_TYPE_VALUES,
  CONTRACT_FIELD_LABEL,
  CONTRACT_TYPE_LABEL,
  CONTRACT_TYPE_VALUES,
  CURRENCY_LABEL,
  CURRENCY_VALUES,
  validateContractRules,
  EXTRACTABLE_FIELDS,
  type ContractDetail,
  type ExtractionResult,
  type ContractType,
  type Currency,
  type UserBrief,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { attachmentApi, contractApi, userApi } from '../api/resources'
import { useAuth } from '../auth/AuthContext'
import { ExtractionPanel, ExtractionSummary } from '../components/ExtractionPanel'
import { useToast } from '../components/overlays'
import {
  Button,
  Card,
  Checkbox,
  ErrorNotice,
  Field,
  Input,
  LoadingBlock,
  Select,
  Textarea,
} from '../components/ui'

interface FormValues {
  contractNo: string
  title: string
  contractType: string
  counterpartyName: string
  counterpartyContact: string
  amountType: string
  amount: string
  currency: Currency
  paymentTerms: string
  signDate: string
  effectiveDate: string
  expiryDate: string
  isPerpetual: boolean
  ownerId: string
  originalLocation: string
  remark: string
}

const EMPTY: FormValues = {
  contractNo: '',
  title: '',
  contractType: '',
  counterpartyName: '',
  counterpartyContact: '',
  amountType: '',
  amount: '',
  currency: 'CNY',
  paymentTerms: '',
  signDate: '',
  effectiveDate: '',
  expiryDate: '',
  isPerpetual: false,
  ownerId: '',
  originalLocation: '',
  remark: '',
}

function fromDetail(d: ContractDetail): FormValues {
  return {
    contractNo: d.contractNo ?? '',
    title: d.title,
    contractType: d.contractType ?? '',
    counterpartyName: d.counterpartyName ?? '',
    counterpartyContact: d.counterpartyContact ?? '',
    amountType: d.amountType ?? '',
    amount: d.amount ?? '',
    currency: d.currency,
    paymentTerms: d.paymentTerms ?? '',
    signDate: d.signDate ?? '',
    effectiveDate: d.effectiveDate ?? '',
    expiryDate: d.expiryDate ?? '',
    isPerpetual: d.isPerpetual,
    ownerId: d.owner?.id ?? '',
    originalLocation: d.originalLocation ?? '',
    remark: d.remark ?? '',
  }
}

/** 表单的空串 → 接口的 null。跨字段校验也用这份结果，前后端判定才一致。 */
function toPayload(v: FormValues): Record<string, unknown> {
  const blank = (s: string) => (s.trim() === '' ? null : s.trim())
  return {
    contractNo: blank(v.contractNo),
    title: v.title.trim(),
    contractType: blank(v.contractType),
    counterpartyName: blank(v.counterpartyName),
    counterpartyContact: blank(v.counterpartyContact),
    amountType: blank(v.amountType),
    amount: blank(v.amount),
    currency: v.currency,
    paymentTerms: blank(v.paymentTerms),
    signDate: blank(v.signDate),
    effectiveDate: blank(v.effectiveDate),
    expiryDate: blank(v.expiryDate),
    isPerpetual: v.isPerpetual,
    ownerId: blank(v.ownerId),
    originalLocation: blank(v.originalLocation),
    remark: blank(v.remark),
  }
}

export function ContractFormPage(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [values, setValues] = useState<FormValues>(EMPTY)
  const [users, setUsers] = useState<UserBrief[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [topError, setTopError] = useState<string | null>(null)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState<'draft' | 'activate' | null>(null)
  const [generating, setGenerating] = useState(false)
  const [detail, setDetail] = useState<ContractDetail | null>(null)

  // 识别结果与原文件。原文件留在内存里，合同保存成功后自动补传成附件 ——
  // 比在后端搞一套 pending upload 简单得多，而且天然复用已有的附件留痕。
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [sourceFile, setSourceFile] = useState<File | null>(null)

  useEffect(() => {
    document.title = `${isEdit ? '编辑合同' : '新建合同'} · 合同管理系统`
  }, [isEdit])

  useEffect(() => {
    const ac = new AbortController()
    userApi
      .list(ac.signal)
      .then((res) => setUsers(res.data))
      .catch(() => {
        /* 下拉拿不到不阻塞录入 */
      })
    return () => ac.abort()
  }, [])

  // 新建时经办人默认是当前用户
  useEffect(() => {
    if (!isEdit && user) setValues((v) => (v.ownerId ? v : { ...v, ownerId: user.id }))
  }, [isEdit, user])

  useEffect(() => {
    if (!id) return
    const ac = new AbortController()
    setLoading(true)
    contractApi
      .detail(id, ac.signal)
      .then((res) => {
        setDetail(res.data)
        setValues(fromDetail(res.data))
      })
      .catch((err) => {
        if (!ac.signal.aborted) setTopError(err instanceof ApiError ? err.message : '加载失败')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [id])

  /** 把识别结果填进表单。只覆盖识别到的字段，用户已经手填的内容不动。 */
  const applyExtraction = (result: ExtractionResult, file: File): void => {
    setExtraction(result)
    setSourceFile(file)
    setErrors({})
    setValues((prev) => {
      const next = { ...prev }
      for (const field of EXTRACTABLE_FIELDS) {
        const got = result.fields[field]
        if (!got || got.value === null) continue
        if (field === 'isPerpetual') {
          next.isPerpetual = got.value === true
        } else {
          next[field] = String(got.value) as never
        }
      }
      // 长期有效与到期日期互斥，识别结果里两个都有时以「长期有效」为准
      if (next.isPerpetual) next.expiryDate = ''
      return next
    })
    setTopError(
      result.meta.fieldCount === 0
        ? '没有识别出可用字段，请手工录入'
        : null,
    )
  }

  /** 取该字段的识别置信度，用于在 Field 上显示 AI 标记和原文出处 */
  const ex = (field: string) =>
    extraction?.fields[field as (typeof EXTRACTABLE_FIELDS)[number]] ?? null

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void => {
    setValues((v) => ({ ...v, [key]: value }))
    // 用户一动这个字段就把它的红字清掉，别让旧错误一直挂着
    setErrors((e) => (e[key as string] ? { ...e, [key as string]: '' } : e))
  }

  const noAmount = values.amountType === 'NO_AMOUNT'
  const readonlyByStatus = isEdit && detail && !detail.permissions.canEdit

  const generateNo = async (): Promise<void> => {
    if (!values.contractType) {
      setErrors((e) => ({ ...e, contractType: '请先选择合同类型，编号按类型生成' }))
      return
    }
    setGenerating(true)
    try {
      const { data } = await contractApi.nextNo(values.contractType as ContractType)
      set('contractNo', data.contractNo)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '生成编号失败')
    } finally {
      setGenerating(false)
    }
  }

  const submit = async (mode: 'draft' | 'activate', e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    setTopError(null)

    const payload = toPayload(values)

    // 先在本地跑一遍跟后端完全相同的规则，能立刻给出红字，不用等一个来回
    const local: Record<string, string> = {}
    if (!payload.title) local.title = '合同名称不能为空'
    for (const issue of validateContractRules(payload as never, { strict: mode === 'activate' })) {
      if (!local[issue.field]) local[issue.field] = issue.message
    }
    if (Object.keys(local).length > 0) {
      setErrors(local)
      setTopError(
        mode === 'activate'
          ? `还差 ${Object.keys(local).length} 项没填好，补齐后才能提交审核`
          : '有 ' + Object.keys(local).length + ' 项填写有误，请检查标红的字段',
      )
      return
    }

    setErrors({})
    setSaving(mode)
    try {
      if (isEdit && id) {
        await contractApi.update(id, payload)
        if (mode === 'activate') {
          await contractApi.changeStatus(id, { action: 'SUBMIT' })
        }
        toast.success(mode === 'activate' ? '已提交审核' : '已保存')
        navigate(`/contracts/${id}`)
      } else {
        const { data } = await contractApi.create({ ...payload, activate: mode === 'activate' })

        // 用于识别的原件自动存成该合同的附件（合同正本），用户不用再传一次。
        // 失败不回滚合同 —— 合同已经建好了，附件没传上只是少个文件，提示一下即可。
        if (sourceFile) {
          try {
            await attachmentApi.upload(data.id, sourceFile, 'ORIGINAL')
          } catch {
            toast.error('合同已保存，但原件上传失败，请到详情页手工上传')
          }
        }

        toast.success(mode === 'activate' ? '合同已创建并提交审核' : '已存为草稿')
        navigate(`/contracts/${data.id}`)
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.fieldErrors()
        setErrors(fieldErrors)
        setTopError(
          Object.keys(fieldErrors).length > 0
            ? `${err.message}：${Object.entries(fieldErrors)
                .map(([f]) => CONTRACT_FIELD_LABEL[f] ?? f)
                .join('、')}`
            : err.message,
        )
      } else {
        setTopError('保存失败，请稍后重试')
      }
    } finally {
      setSaving(null)
    }
  }

  const ownerOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.displayName })),
    [users],
  )

  if (loading) return <LoadingBlock />

  if (readonlyByStatus) {
    return (
      <Card title="无法编辑">
        <p className="text-sm text-slate-700">
          {detail?.status === 'CLOSED'
            ? '该合同已完结，处于只读状态。需要修改请让管理员先解除完结。'
            : detail?.status === 'PENDING_APPROVAL'
            ? '该合同正在审核中，不能修改。需要改动请先撤回，撤回后审核意见作废。'
            : '你没有编辑这份合同的权限，只有经办人本人和合同管理员可以修改。'}
        </p>
        <div className="mt-4">
          <Link to={`/contracts/${id}`}>
            <Button>返回详情</Button>
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <form onSubmit={(e) => void submit('draft', e)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-800">
            {isEdit ? '编辑合同' : '新建合同'}
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            带 <span className="text-rose-500">*</span> 的是提交审核时必填。存草稿只要有合同名称就行。
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={isEdit ? `/contracts/${id}` : '/contracts'}>
            <Button>取消</Button>
          </Link>
          <Button onClick={() => void submit('draft')} loading={saving === 'draft'}>
            {isEdit ? '保存' : '存为草稿'}
          </Button>
          {(!isEdit || detail?.status === 'DRAFT') && (
            <Button
              variant="primary"
              onClick={() => void submit('activate')}
              loading={saving === 'activate'}
            >
              保存并提交审核
            </Button>
          )}
        </div>
      </div>

      {!isEdit && (
        <div className="mb-4">
          {extraction ? (
            <ExtractionSummary
              result={extraction}
              file={sourceFile}
              onClear={() => {
                setExtraction(null)
                setSourceFile(null)
              }}
            />
          ) : (
            <ExtractionPanel onExtracted={applyExtraction} disabled={saving !== null} />
          )}
        </div>
      )}

      {topError && (
        <div className="mb-4">
          <ErrorNotice message={topError} />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Card title="基础信息">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="合同类型" required error={errors.contractType} htmlFor="contractType" extraction={ex('contractType')}>
              <Select
                id="contractType"
                value={values.contractType}
                invalid={!!errors.contractType}
                onChange={(e) => set('contractType', e.target.value)}
              >
                <option value="">请选择</option>
                {CONTRACT_TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>
                    {CONTRACT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="合同编号"
              required
              error={errors.contractNo}
              hint="格式 类型缩写-年份-流水，如 CG-2026-0001"
              htmlFor="contractNo" extraction={ex('contractNo')}
            >
              <div className="flex gap-2">
                <Input
                  id="contractNo"
                  value={values.contractNo}
                  invalid={!!errors.contractNo}
                  onChange={(e) => set('contractNo', e.target.value)}
                  placeholder="可手工填写"
                  className="font-mono tabular"
                />
                <Button onClick={() => void generateNo()} loading={generating} className="shrink-0">
                  自动生成
                </Button>
              </div>
            </Field>

            <Field
              label="合同名称"
              required
              error={errors.title}
              htmlFor="title" extraction={ex('title')}
              className="sm:col-span-2"
            >
              <Input
                id="title"
                value={values.title}
                invalid={!!errors.title}
                onChange={(e) => set('title', e.target.value)}
                autoFocus={!isEdit}
              />
            </Field>

            <Field label="对方单位" required error={errors.counterpartyName} htmlFor="counterpartyName" extraction={ex('counterpartyName')}>
              <Input
                id="counterpartyName"
                value={values.counterpartyName}
                invalid={!!errors.counterpartyName}
                onChange={(e) => set('counterpartyName', e.target.value)}
                placeholder="对方公司全称"
              />
            </Field>

            <Field label="对方联系人" error={errors.counterpartyContact} htmlFor="counterpartyContact" extraction={ex('counterpartyContact')}>
              <Input
                id="counterpartyContact"
                value={values.counterpartyContact}
                onChange={(e) => set('counterpartyContact', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="金额与结算">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="金额类型" required error={errors.amountType} htmlFor="amountType" extraction={ex('amountType')}>
              <Select
                id="amountType"
                value={values.amountType}
                invalid={!!errors.amountType}
                onChange={(e) => {
                  const next = e.target.value
                  set('amountType', next)
                  // 选了「无金额」就把金额清掉，避免留下互相矛盾的数据
                  if (next === 'NO_AMOUNT') set('amount', '')
                }}
              >
                <option value="">请选择</option>
                {AMOUNT_TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>
                    {AMOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="合同金额"
              error={errors.amount}
              hint={noAmount ? '金额类型为「无金额」，无需填写' : undefined}
              htmlFor="amount" extraction={ex('amount')}
            >
              <Input
                id="amount"
                inputMode="decimal"
                value={values.amount}
                disabled={noAmount}
                invalid={!!errors.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="0.00"
                className="text-right tabular"
              />
            </Field>

            <Field label="币种" htmlFor="currency" extraction={ex('currency')}>
              <Select
                id="currency"
                value={values.currency}
                disabled={noAmount}
                onChange={(e) => set('currency', e.target.value as Currency)}
              >
                {CURRENCY_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABEL[c]}（{c}）
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="付款结算方式"
              error={errors.paymentTerms}
              htmlFor="paymentTerms" extraction={ex('paymentTerms')}
              className="sm:col-span-3"
            >
              <Textarea
                id="paymentTerms"
                rows={2}
                value={values.paymentTerms}
                onChange={(e) => set('paymentTerms', e.target.value)}
                placeholder="如：预付 30%，验收后付 60%，质保金 10% 满 12 个月付清"
              />
            </Field>
          </div>
        </Card>

        <Card title="日期与期限">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="签订日期" required error={errors.signDate} htmlFor="signDate" extraction={ex('signDate')}>
              <Input
                id="signDate"
                type="date"
                value={values.signDate}
                invalid={!!errors.signDate}
                onChange={(e) => set('signDate', e.target.value)}
                className="tabular"
              />
            </Field>

            <Field label="生效日期" required error={errors.effectiveDate} htmlFor="effectiveDate" extraction={ex('effectiveDate')}>
              <Input
                id="effectiveDate"
                type="date"
                value={values.effectiveDate}
                invalid={!!errors.effectiveDate}
                onChange={(e) => set('effectiveDate', e.target.value)}
                className="tabular"
              />
            </Field>

            <Field
              label="到期日期"
              required={!values.isPerpetual}
              error={errors.expiryDate}
              hint={values.isPerpetual ? '已勾选长期有效，无需填写' : undefined}
              htmlFor="expiryDate" extraction={ex('expiryDate')}
            >
              <Input
                id="expiryDate"
                type="date"
                value={values.expiryDate}
                disabled={values.isPerpetual}
                invalid={!!errors.expiryDate}
                onChange={(e) => set('expiryDate', e.target.value)}
                className="tabular"
              />
            </Field>

            <div className="sm:col-span-3">
              <Checkbox
                label="长期有效（如保密协议、框架协议）"
                checked={values.isPerpetual}
                onChange={(e) => {
                  set('isPerpetual', e.target.checked)
                  if (e.target.checked) set('expiryDate', '')
                }}
              />
            </div>
          </div>
        </Card>

        <Card title="内部管理">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="经办人" required error={errors.ownerId} htmlFor="ownerId">
              <Select
                id="ownerId"
                value={values.ownerId}
                invalid={!!errors.ownerId}
                onChange={(e) => set('ownerId', e.target.value)}
              >
                <option value="">请选择</option>
                {ownerOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="原件存放位置" error={errors.originalLocation} htmlFor="originalLocation">
              <Input
                id="originalLocation"
                value={values.originalLocation}
                onChange={(e) => set('originalLocation', e.target.value)}
                placeholder="如：行政部档案柜 A-03"
              />
            </Field>

            <Field label="备注" error={errors.remark} htmlFor="remark" className="sm:col-span-2">
              <Textarea
                id="remark"
                rows={3}
                value={values.remark}
                onChange={(e) => set('remark', e.target.value)}
              />
            </Field>
          </div>
        </Card>
      </div>
    </form>
  )
}
