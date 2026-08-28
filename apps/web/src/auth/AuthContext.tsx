import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthenticatedUser, Role } from '@contract/shared'
import { roleAtLeast } from '@contract/shared'
import { getSession, onSessionChange } from '../api/client'
import { authApi } from '../api/resources'

interface AuthState {
  user: AuthenticatedUser | null
  /** 首次从存储里恢复会话期间为 true，避免闪一下登录页 */
  restoring: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (min: Role) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    let alive = true

    void (async () => {
      const session = await getSession()
      if (!alive) return
      if (!session) {
        setRestoring(false)
        return
      }
      // 本地有会话不代表还有效：回服务端确认一次，顺便拿到最新的角色
      try {
        const { data } = await authApi.me()
        if (alive) setUser(data)
      } catch {
        if (alive) setUser(null)
      } finally {
        if (alive) setRestoring(false)
      }
    })()

    // token 失效时 client 会清掉会话，这里同步把用户置空，路由自动跳登录页
    const off = onSessionChange((s) => {
      if (!s) setUser(null)
    })

    return () => {
      alive = false
      off()
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    setUser(await authApi.login(username, password))
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      restoring,
      login,
      logout,
      can: (min: Role) => (user ? roleAtLeast(user.role, min) : false),
    }),
    [user, restoring, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
