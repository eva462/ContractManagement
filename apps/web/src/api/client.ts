import type { ApiFailure, ApiMeta, ErrorCode, FieldIssue, LoginResult } from '@contract/shared'
import { API_PREFIX } from '../config'
import { tokenStore, type StoredSession } from '../auth/tokenStore'

/** 接口返回的业务错误。前端靠 code 和 issues 做处理，不要去匹配 message 文案。 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status: number,
    readonly issues: FieldIssue[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** 把 issues 转成 { 字段名: 提示 }，直接喂给表单 */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const i of this.issues) if (!out[i.field]) out[i.field] = i.message
    return out
  }
}

type SessionListener = (session: StoredSession | null) => void
const listeners = new Set<SessionListener>()

export function onSessionChange(fn: SessionListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(session: StoredSession | null): void {
  for (const fn of listeners) fn(session)
}

export async function saveSession(result: LoginResult): Promise<StoredSession> {
  const session: StoredSession = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
    user: result.user,
  }
  await tokenStore.set(session)
  emit(session)
  return session
}

export async function clearSession(): Promise<void> {
  await tokenStore.clear()
  emit(null)
}

export const getSession = (): Promise<StoredSession | null> => tokenStore.get()

/* ── token 续期 ─────────────────────────────────────────────────────── */

/** 提前 60 秒续期，避免请求刚发出去 token 就过期了 */
const REFRESH_MARGIN_MS = 60_000

// 多个请求同时发现 token 过期时，只发一次 refresh，其余等这一次的结果
let refreshInFlight: Promise<StoredSession | null> | null = null

async function refreshSession(current: StoredSession): Promise<StoredSession | null> {
  // 先把 promise 存在局部变量里再返回：下面的 finally 会把 refreshInFlight 置空，
  // 直接 return 那个字段有可能拿到 null
  const inFlight = refreshInFlight ?? (refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      })
      if (!res.ok) {
        await clearSession()
        return null
      }
      const json = (await res.json()) as { data: LoginResult }
      return await saveSession(json.data)
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })())
  return inFlight
}

async function authHeader(): Promise<Record<string, string>> {
  let session = await tokenStore.get()
  if (!session) return {}

  if (session.accessTokenExpiresAt - Date.now() < REFRESH_MARGIN_MS) {
    session = (await refreshSession(session)) ?? null
    if (!session) return {}
  }
  return { Authorization: `Bearer ${session.accessToken}` }
}

/* ── 请求 ──────────────────────────────────────────────────────────── */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** FormData 时不要设 Content-Type，让浏览器自己带 boundary */
  formData?: FormData
  signal?: AbortSignal
  /** 登录等接口不需要带 token */
  anonymous?: boolean
}

export interface ApiResult<T> {
  data: T
  meta?: ApiMeta
}

async function toApiError(res: Response): Promise<ApiError> {
  let payload: ApiFailure | null = null
  try {
    payload = (await res.json()) as ApiFailure
  } catch {
    /* 非 JSON 响应 */
  }
  if (payload?.error) {
    return new ApiError(payload.error.code, payload.error.message, res.status, payload.error.issues ?? [])
  }
  return new ApiError('INTERNAL', `请求失败（HTTP ${res.status}）`, res.status)
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  if (!opts.anonymous) Object.assign(headers, await authHeader())

  let body: BodyInit | undefined
  if (opts.formData) {
    body = opts.formData
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('NETWORK', '连不上服务器，请确认后端已启动（npm run dev）', 0)
  }

  if (res.status === 401 && !opts.anonymous) {
    // token 失效：清掉会话，让路由把用户送回登录页
    await clearSession()
  }

  if (!res.ok) throw await toApiError(res)

  if (res.status === 204) return { data: undefined as T }
  return (await res.json()) as ApiResult<T>
}

/** 走 fetch 拿二进制（下载附件）。同样带鉴权，绝不把 token 拼进 URL。 */
export async function requestBlob(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const headers = await authHeader()
  const res = await fetch(`${API_PREFIX}${path}`, { headers })
  if (!res.ok) throw await toApiError(res)

  const cd = res.headers.get('content-disposition') ?? ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  const plain = /filename="([^"]+)"/i.exec(cd)
  const fileName = star ? decodeURIComponent(star[1]!) : (plain?.[1] ?? null)

  return { blob: await res.blob(), fileName }
}
