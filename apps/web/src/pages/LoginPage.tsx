import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button, ErrorNotice, Field, Input, LoadingBlock } from '../components/ui'

export function LoginPage(): ReactNode {
  const { user, restoring, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = '登录 · 合同管理系统'
  }, [])

  if (restoring) return <LoadingBlock label="正在恢复登录状态…" />
  if (user) {
    const from = (location.state as { from?: Location } | null)?.from
    return <Navigate to={from?.pathname ?? '/contracts'} replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      const from = (location.state as { from?: Location } | null)?.from
      navigate(from?.pathname ?? '/contracts', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-slate-800">合同管理系统</h1>
          <p className="mt-1 text-sm text-slate-600">本地开发环境</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-lg bg-white p-5 ring-1 ring-slate-200"
        >
          {error && <ErrorNotice message={error} />}

          <Field label="用户名" required htmlFor="username">
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </Field>

          <Field label="密码" required htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
            登录
          </Button>
        </form>

        <div className="mt-4 rounded-md bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
          <p className="mb-1 font-medium text-slate-700">本地种子账号（密码均为 admin123）</p>
          <p className="tabular">
            admin · 系统管理员　　manager · 合同管理员　　staff · 经办人
          </p>
        </div>
      </div>
    </div>
  )
}
