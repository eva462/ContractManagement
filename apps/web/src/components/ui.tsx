import { forwardRef, type ReactNode } from 'react'
import {
  CONFIDENCE_LABEL,
  CONTRACT_STATUS_LABEL,
  EXPIRY_STATE_LABEL,
  type Confidence,
  type ContractStatus,
  type ExpiryState,
} from '@contract/shared'

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ')

/* ── 按钮 ──────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-slate-800 text-white hover:bg-slate-700 disabled:bg-slate-400',
  secondary:
    'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-300',
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
  size?: 'sm' | 'md'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', loading, size = 'md', className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800',
        'disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm',
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }): ReactNode {
  return (
    <span
      className={cx(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      aria-hidden
    />
  )
}

/* ── 表单 ──────────────────────────────────────────────────────────── */

const FIELD_BASE =
  'w-full rounded-md bg-white px-3 py-2 text-slate-900 ring-1 ring-slate-300 transition ' +
  'placeholder:text-slate-400 focus:ring-2 focus:ring-slate-800 focus:outline-none ' +
  'disabled:bg-slate-100 disabled:text-slate-600 read-only:bg-slate-50'

const FIELD_ERROR = 'ring-rose-400 focus:ring-rose-500'

export interface FieldProps {
  label: string
  required?: boolean
  error?: string
  hint?: string
  htmlFor?: string
  children: ReactNode
  className?: string
  /** 该字段由 AI 识别填入时的置信度与原文出处 */
  extraction?: { confidence: Confidence; evidence: string | null } | null
}

export function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
  className,
  extraction,
}: FieldProps): ReactNode {
  const lowConfidence = extraction?.confidence === 'low'
  return (
    <div
      className={cx(
        'flex flex-col gap-1.5',
        // 低置信度整格加黄底，让人一眼看到该重点核对哪几项
        lowConfidence && '-m-1.5 rounded-md bg-amber-50 p-1.5 ring-1 ring-amber-200',
        className,
      )}
    >
      <label htmlFor={htmlFor} className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-slate-700">
        <span>
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </span>
        {extraction && (
          <span
            title={extraction.evidence ? `合同原文：${extraction.evidence}` : undefined}
            className={cx(
              'rounded px-1.5 py-px text-[10px] font-normal ring-1 ring-inset',
              lowConfidence
                ? 'bg-amber-100 text-amber-800 ring-amber-300'
                : 'bg-slate-100 text-slate-600 ring-slate-200',
            )}
          >
            AI · {CONFIDENCE_LABEL[extraction.confidence]}
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : extraction?.evidence ? (
        <p className="truncate text-xs text-slate-600" title={extraction.evidence}>
          原文：{extraction.evidence}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-600">{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD_BASE, invalid && FIELD_ERROR, className)} {...rest} />
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(FIELD_BASE, 'resize-y', invalid && FIELD_ERROR, className)}
      {...rest}
    />
  )
})

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(FIELD_BASE, 'pr-8', invalid && FIELD_ERROR, className)} {...rest}>
      {children}
    </select>
  )
})

export function Checkbox({
  label,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }): ReactNode {
  return (
    <label
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 select-none',
        rest.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        type="checkbox"
        className="size-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800"
        {...rest}
      />
      {label}
    </label>
  )
}

/* ── 状态标签 ───────────────────────────────────────────────────────── */

// 三个 PENDING_* 是「球在谁那儿」的中间态，用暖色/冷色区分该谁动：
// 待审核=等人审（琥珀）、待签署=等线下盖章（蓝）、待归档=等传扫描件（紫）
const STATUS_STYLES: Record<ContractStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-300',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 ring-amber-300',
  PENDING_SIGNING: 'bg-sky-50 text-sky-700 ring-sky-300',
  PENDING_FILING: 'bg-violet-50 text-violet-700 ring-violet-300',
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  TERMINATED: 'bg-orange-50 text-orange-700 ring-orange-300',
  CLOSED: 'bg-slate-200 text-slate-700 ring-slate-300',
}

export function StatusBadge({ status }: { status: ContractStatus }): ReactNode {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_STYLES[status],
      )}
    >
      {CONTRACT_STATUS_LABEL[status]}
    </span>
  )
}

const EXPIRY_STYLES: Partial<Record<ExpiryState, string>> = {
  EXPIRED: 'bg-rose-50 text-rose-700 ring-rose-300',
  EXPIRING: 'bg-amber-50 text-amber-700 ring-amber-300',
  PERPETUAL: 'bg-sky-50 text-sky-700 ring-sky-300',
}

/** 「已过期 / 即将到期 / 长期有效」是派生态，正常状态不显示标记。 */
export function ExpiryBadge({ state }: { state: ExpiryState }): ReactNode {
  const style = EXPIRY_STYLES[state]
  if (!style) return null
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        style,
      )}
    >
      {EXPIRY_STATE_LABEL[state]}
    </span>
  )
}

/* ── 容器 ──────────────────────────────────────────────────────────── */

export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}): ReactNode {
  return (
    <section className={cx('rounded-lg bg-white ring-1 ring-slate-200', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          ) : (
            title
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorNotice({ message }: { message: string }): ReactNode {
  return (
    <div
      role="alert"
      className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200"
    >
      {message}
    </div>
  )
}

export function LoadingBlock({ label = '加载中…' }: { label?: string }): ReactNode {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-600">
      <Spinner />
      {label}
    </div>
  )
}
