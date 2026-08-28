import type { AuthenticatedUser, TokenPair } from '@contract/shared'

/**
 * ★ 认证可替换边界
 *
 * 业务代码只依赖这个接口，不知道底下是本地密码还是 SSO。
 * 换成 OIDC / 钉钉 / 企微时，写一个新的实现类在 index.ts 里换掉即可，
 * 路由和服务层零改动。
 */

export interface Credentials {
  username: string
  password: string
}

export interface RequestContext {
  ip: string | null
  userAgent: string | null
}

export interface AccessClaims {
  userId: string
}

export interface AuthProvider {
  /** 实现名，写进日志和审计，方便以后排查是哪套认证放进来的人 */
  readonly name: string

  /** 校验凭据。失败返回 null，不要抛异常 —— 调用方需要区分「密码错」和「系统故障」。 */
  authenticate(credentials: Credentials, ctx: RequestContext): Promise<AuthenticatedUser | null>

  /** 发一对新 token */
  issueTokens(user: AuthenticatedUser): Promise<TokenPair>

  /** 校验 access token，返回声明；无效或过期返回 null */
  verifyAccessToken(token: string): Promise<AccessClaims | null>

  /** 用 refresh token 换新的一对 token。同时作废旧的 refresh token（轮换）。 */
  exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ user: AuthenticatedUser; tokens: TokenPair } | null>

  /** 登出：作废这个 refresh token */
  revokeRefreshToken(refreshToken: string): Promise<void>

  /** 作废某用户全部 refresh token（改密码、停用账号时调用） */
  revokeAllForUser(userId: string): Promise<void>

  /** 改密码。当前密码不对返回 false。 */
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean>

  /** 建账号时用来算哈希 */
  hashPassword(plain: string): Promise<string>
}
