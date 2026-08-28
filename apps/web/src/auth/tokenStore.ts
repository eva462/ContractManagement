import type { AuthenticatedUser } from '@contract/shared'

/**
 * ★ Token 存储可替换边界
 *
 * 接口刻意做成异步的 —— 现在底下是同步的 localStorage，
 * 但以后换成 Capacitor Preferences（iOS 上落到 Keychain）时是异步 API，
 * 到那时只需要换一个实现，调用方一行不改。
 */

export interface StoredSession {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: number
  user: AuthenticatedUser
}

export interface TokenStore {
  readonly name: string
  get(): Promise<StoredSession | null>
  set(session: StoredSession): Promise<void>
  clear(): Promise<void>
}

const KEY = 'contract.session.v1'

class LocalStorageTokenStore implements TokenStore {
  readonly name = 'localStorage'

  async get(): Promise<StoredSession | null> {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as StoredSession
      if (!parsed?.accessToken || !parsed?.user) return null
      return parsed
    } catch {
      // 隐私模式、被清空、格式损坏 —— 一律当没登录处理，不要炸掉整个应用
      return null
    }
  }

  async set(session: StoredSession): Promise<void> {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(session))
    } catch {
      /* 存不进去也让用户能继续用完这一次会话 */
    }
  }

  async clear(): Promise<void> {
    try {
      window.localStorage.removeItem(KEY)
    } catch {
      /* 忽略 */
    }
  }
}

export const tokenStore: TokenStore = new LocalStorageTokenStore()
