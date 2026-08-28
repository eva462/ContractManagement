import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser, Role, TokenPair } from '@contract/shared'
import { env } from '../env.js'
import { hashPassword, verifyPassword } from './password.js'
import type { AccessClaims, AuthProvider, Credentials, RequestContext } from './provider.js'

const secret = new TextEncoder().encode(env.jwtSecret)
const ISSUER = 'contract-management'
const AUDIENCE = 'contract-management-client'

/** '30d' / '12h' / '90m' → 毫秒 */
function ttlToMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim())
  if (!m) throw new Error(`TTL 格式不对: "${ttl}"，应形如 2h / 30d`)
  const n = Number(m[1])
  const unit = m[2] as 's' | 'm' | 'h' | 'd'
  return n * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

function toAuthUser(u: {
  id: string
  username: string
  displayName: string
  role: string
  isActive: boolean
}): AuthenticatedUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role as Role,
    isActive: u.isActive,
  }
}

/**
 * 本地账号密码 + JWT。
 *
 * 为什么用 Bearer Token 而不是 Session Cookie：以后这套前端要被 Capacitor 打成
 * App，App 页面来自 capacitor://localhost 而 API 在另一个域，属于跨站；
 * iOS 的 ITP 会限制跨站 Cookie。Token 方案在浏览器和 App 里行为一致。
 */
export class LocalPasswordAuthProvider implements AuthProvider {
  readonly name = 'local-password'

  constructor(private readonly db: PrismaClient) {}

  async authenticate(credentials: Credentials, _ctx: RequestContext): Promise<AuthenticatedUser | null> {
    const user = await this.db.user.findUnique({ where: { username: credentials.username } })

    if (!user) {
      // 用户不存在时也走一次哈希，让「用户不存在」和「密码错误」耗时相近
      await verifyPassword(credentials.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
      return null
    }
    if (!user.isActive) return null
    if (!(await verifyPassword(credentials.password, user.passwordHash))) return null

    return toAuthUser(user)
  }

  async issueTokens(user: AuthenticatedUser): Promise<TokenPair> {
    const accessTtl = ttlToMs(env.accessTokenTtl)
    const refreshTtl = ttlToMs(env.refreshTokenTtl)
    const now = Date.now()

    const accessToken = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor((now + accessTtl) / 1000))
      .sign(secret)

    // refresh token 是不透明随机串，库里只存哈希；即使库泄露也换不出 access token
    const refreshToken = randomBytes(32).toString('base64url')
    await this.db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(now + refreshTtl),
      },
    })

    return { accessToken, refreshToken, accessTokenExpiresAt: now + accessTtl }
  }

  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE })
      if (!payload.sub) return null
      return { userId: payload.sub }
    } catch {
      return null
    }
  }

  async exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ user: AuthenticatedUser; tokens: TokenPair } | null> {
    const record = await this.db.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    })

    if (!record || record.revokedAt || record.expiresAt < new Date()) return null
    if (!record.user.isActive) return null

    // 轮换：旧的立刻作废，一个 refresh token 只能用一次
    await this.db.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    })

    const user = toAuthUser(record.user)
    return { user, tokens: await this.issueTokens(user) }
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.db.user.findUnique({ where: { id: userId } })
    if (!user) return false
    if (!(await verifyPassword(currentPassword, user.passwordHash))) return false

    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    })
    // 改密码后其他设备上的会话应立即失效
    await this.revokeAllForUser(userId)
    return true
  }

  hashPassword(plain: string): Promise<string> {
    return hashPassword(plain)
  }
}
