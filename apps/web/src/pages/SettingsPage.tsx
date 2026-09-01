import { useEffect, useState, type ReactNode } from 'react'
import {
  DICT_CODES,
  DICT_META,
  ROLE_LABEL,
  type DictCode,
  type DictItemDto,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { dictApi, useDict } from '../api/dict'
import { useAuth } from '../auth/AuthContext'
import { ConfirmDialog, Modal, useToast } from '../components/overlays'
import { ReviewRuleSettings } from '../components/ReviewRuleSettings'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LoadingBlock,
  cx,
} from '../components/ui'

type Tab = 'dict' | 'review' | 'suppliers' | 'users'

const TABS: { key: Tab; label: string; ready: boolean }[] = [
  { key: 'dict', label: '数据字典', ready: true },
  { key: 'review', label: 'AI 审查要点', ready: true },
  { key: 'suppliers', label: '供应商', ready: false },
  { key: 'users', label: '用户与权限', ready: false },
]

export function SettingsPage(): ReactNode {
  const [tab, setTab] = useState<Tab>('dict')

  useEffect(() => {
    document.title = '设置 · 合同管理系统'
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">设置</h1>
        <p className="mt-1 text-sm text-slate-600">
          在这里维护系统的基础数据，改完立刻生效，不需要改代码重新部署。
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-300">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-slate-800 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-800',
            )}
          >
            {t.label}
            {!t.ready && (
              <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-px text-[10px] font-normal text-slate-600">
                未开放
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'dict' && <DictSettings />}
      {tab === 'review' && <ReviewRuleSettings />}
      {tab === 'suppliers' && <SupplierPlaceholder />}
      {tab === 'users' && <UserPlaceholder />}
    </div>
  )
}

/* ── 数据字典 ───────────────────────────────────────────────────────── */

function DictSettings(): ReactNode {
  const [code, setCode] = useState<DictCode>('CONTRACT_TYPE')
  const meta = DICT_META[code]
  // 设置页要看到停用的项，否则没法重新启用
  const { items, loading, reload } = useDict(code, { includeInactive: true })

  const [editing, setEditing] = useState<DictItemDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<DictItemDto | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const onDelete = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    try {
      await dictApi.remove(deleting.id)
      toast.success('已删除')
      setDeleting(null)
      reload()
    } catch (err) {
      // 被引用过的项后端会拒绝，把「请改用停用」的原话透给用户
      toast.error(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : '删除失败')
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (item: DictItemDto): Promise<void> => {
    try {
      await dictApi.update(item.id, { isActive: !item.isActive })
      toast.success(item.isActive ? '已停用' : '已启用')
      reload()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '操作失败')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {DICT_CODES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCode(c)}
            className={cx(
              'rounded-md px-3 py-1.5 text-sm font-medium ring-1 transition-colors',
              code === c
                ? 'bg-slate-800 text-white ring-slate-800'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {DICT_META[c].label}
          </button>
        ))}
      </div>

      <Card
        title={meta.label}
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            新增
          </Button>
        }
      >
        <p className="mb-3 text-sm text-slate-600">{meta.description}</p>

        {loading ? (
          <LoadingBlock />
        ) : items.length === 0 ? (
          <EmptyState title="还没有任何选项" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
                  <th className="py-2 pr-3 font-medium">名称</th>
                  <th className="py-2 pr-3 font-medium">编码</th>
                  {meta.hasPrefix && <th className="py-2 pr-3 font-medium">编号前缀</th>}
                  <th className="py-2 pr-3 font-medium">排序</th>
                  <th className="py-2 pr-3 font-medium">被引用</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.id} className={cx(!it.isActive && 'opacity-55')}>
                    <td className="py-2 pr-3 font-medium text-slate-900">{it.itemLabel}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-600">{it.itemCode}</td>
                    {meta.hasPrefix && (
                      <td className="py-2 pr-3 font-mono text-xs text-slate-600">
                        {it.prefix ?? '—'}
                      </td>
                    )}
                    <td className="py-2 pr-3 tabular text-slate-600">{it.sortOrder}</td>
                    <td className="py-2 pr-3 tabular text-slate-600">
                      {it.usageCount > 0 ? `${it.usageCount} 份合同` : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={cx(
                          'rounded px-1.5 py-0.5 text-xs ring-1 ring-inset',
                          it.isActive
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-300'
                            : 'bg-slate-100 text-slate-600 ring-slate-300',
                        )}
                      >
                        {it.isActive ? '启用中' : '已停用'}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>
                          编辑
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void toggleActive(it)}>
                          {it.isActive ? '停用' : '启用'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={it.usageCount > 0}
                          title={it.usageCount > 0 ? '已被合同引用，只能停用' : undefined}
                          onClick={() => setDeleting(it)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
          已被合同引用的选项不能删除，只能<strong>停用</strong>
          ——停用后新建时选不到，历史合同照常显示，不会变成空。
          {meta.hasPrefix && ' 改编号前缀只影响以后新建的合同，已有编号不变。'}
        </p>
      </Card>

      {(creating || editing) && (
        <DictItemDialog
          code={code}
          item={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="删除选项"
        message={`确定删除「${deleting?.itemLabel ?? ''}」？这个选项没有被任何合同引用，删除后不可恢复。`}
        confirmLabel="删除"
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void onDelete()}
      />
    </div>
  )
}

function DictItemDialog({
  code,
  item,
  onClose,
  onSaved,
}: {
  code: DictCode
  item: DictItemDto | null
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const isEdit = item !== null
  const meta = DICT_META[code]
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [form, setForm] = useState({
    itemCode: item?.itemCode ?? '',
    itemLabel: item?.itemLabel ?? '',
    prefix: item?.prefix ?? '',
    sortOrder: String(item?.sortOrder ?? 0),
  })

  const save = async (): Promise<void> => {
    setErrors({})
    setBusy(true)
    try {
      if (isEdit) {
        await dictApi.update(item.id, {
          itemLabel: form.itemLabel,
          prefix: meta.hasPrefix ? form.prefix || null : null,
          sortOrder: Number(form.sortOrder) || 0,
        })
      } else {
        await dictApi.create(code, {
          itemCode: form.itemCode.trim().toUpperCase(),
          itemLabel: form.itemLabel,
          prefix: meta.hasPrefix ? form.prefix.trim().toUpperCase() || null : null,
          sortOrder: Number(form.sortOrder) || 0,
        })
      }
      toast.success(isEdit ? '已保存' : '已新增')
      onSaved()
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors()
        if (Object.keys(fields).length > 0) setErrors(fields)
        else toast.error(err.message)
      } else {
        toast.error('保存失败')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={isEdit ? `编辑「${item.itemLabel}」` : `新增${meta.label}`}
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
      <div className="flex flex-col gap-4">
        <Field label="名称" required error={errors.itemLabel} htmlFor="itemLabel"
          hint="界面上显示的中文名，随时可改">
          <Input
            id="itemLabel"
            value={form.itemLabel}
            invalid={!!errors.itemLabel}
            onChange={(e) => setForm((f) => ({ ...f, itemLabel: e.target.value }))}
            placeholder={code === 'CONTRACT_TYPE' ? '如：技术开发' : '如：市场部'}
          />
        </Field>

        <Field
          label="编码"
          required
          error={errors.itemCode}
          htmlFor="itemCode"
          hint={
            isEdit
              ? '编码建库后不能改——已有合同存的就是这个值'
              : '存进数据库的值，只能用大写字母、数字、下划线。建好后不能改。'
          }
        >
          <Input
            id="itemCode"
            value={form.itemCode}
            readOnly={isEdit}
            invalid={!!errors.itemCode}
            onChange={(e) => setForm((f) => ({ ...f, itemCode: e.target.value.toUpperCase() }))}
            placeholder="如：TECH_DEV"
            className="font-mono"
          />
        </Field>

        {meta.hasPrefix && (
          <Field
            label="合同编号前缀"
            error={errors.prefix}
            htmlFor="prefix"
            hint="只能用大写字母。编号形如「前缀-年份-流水」，例如 CG-2026-0001。留空则用 HT。"
          >
            <Input
              id="prefix"
              value={form.prefix}
              invalid={!!errors.prefix}
              onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value.toUpperCase() }))}
              placeholder="如：JS"
              className="font-mono"
            />
          </Field>
        )}

        <Field label="排序" htmlFor="sortOrder" hint="数字小的排前面，下拉框按这个顺序显示">
          <Input
            id="sortOrder"
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            className="tabular"
          />
        </Field>
      </div>
    </Modal>
  )
}

/* ── 两个占位页 ─────────────────────────────────────────────────────── */

function SupplierPlaceholder(): ReactNode {
  return (
    <Card title="供应商管理">
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>
          这一块会把现在的「对方单位」文本框升级成独立的供应商档案：新建合同时从下拉选择，
          而不是每次手打。这样同一家公司不会再出现「XX科技有限公司／XX科技／XX科技（深圳）」
          三种写法，也能查「跟这家签过多少份合同」。
        </p>
        <ErrorNotice
          tone="info"
          message="字段清单还在确认中——需要财务或合同负责人拍板，尤其是银行账号要不要存进这个系统。"
        />
        <div>
          <p className="mb-1 font-medium text-slate-800">拟定的字段（待确认）</p>
          <ul className="list-disc pl-5 text-slate-600">
            <li>单位全称（与营业执照一致）、统一社会信用代码</li>
            <li>商业登记证／营业执照扫描件</li>
            <li>注册地址、联系人、联系电话与邮箱</li>
            <li>纳税人资格（一般纳税人／小规模）</li>
            <li className="text-slate-800">开户银行与账号 —— 是否纳入本系统需财务确认</li>
          </ul>
        </div>
        <p className="text-slate-600">
          详见 <span className="font-mono text-xs">docs/design/03-审批流程与设置模块.md</span> §4.2。
        </p>
      </div>
    </Card>
  )
}

function UserPlaceholder(): ReactNode {
  const { user } = useAuth()
  return (
    <Card title="用户与权限">
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>
          用户的增删改、角色调整、停用和重置密码，后端接口都已经就绪，界面留到后面的模块补齐。
          现在要加人或改角色，需要直接操作数据库。
        </p>
        <div>
          <p className="mb-1 font-medium text-slate-800">当前的三个角色</p>
          <ul className="list-disc pl-5 text-slate-600">
            <li>
              <strong>{ROLE_LABEL.ADMIN}</strong> —— 全部权限，含解除完结、用户管理
            </li>
            <li>
              <strong>{ROLE_LABEL.MANAGER}</strong> —— 审核、终止、完结、维护字典
            </li>
            <li>
              <strong>{ROLE_LABEL.STAFF}</strong> —— 建合同、改自己经办的、查看全部
            </li>
          </ul>
        </div>
        <p className="text-slate-600">
          你现在的身份是 <strong className="text-slate-800">{user ? ROLE_LABEL[user.role] : '—'}</strong>。
        </p>
      </div>
    </Card>
  )
}
