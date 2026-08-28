import { z } from 'zod'
import { ROLE_VALUES, type Role } from '../enums.js'
import { requiredText } from './common.js'

export const LoginSchema = z.object({
  username: requiredText(64, '用户名'),
  password: z.string().min(1, '密码不能为空').max(200),
})

export type LoginInput = z.input<typeof LoginSchema>

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z
    .string()
    .min(8, '新密码至少 8 位')
    .max(200, '新密码过长'),
})

export const UserCreateSchema = z.object({
  username: requiredText(64, '用户名'),
  displayName: requiredText(64, '显示名'),
  password: z.string().min(8, '密码至少 8 位').max(200),
  role: z.enum(ROLE_VALUES),
})

export const UserUpdateSchema = z.object({
  displayName: requiredText(64, '显示名').optional(),
  role: z.enum(ROLE_VALUES).optional(),
  isActive: z.boolean().optional(),
})

/* ── 响应 DTO ───────────────────────────────────────────────────────── */

export interface AuthenticatedUser {
  id: string
  username: string
  displayName: string
  role: Role
  isActive: boolean
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  /** access token 到期的 Unix 毫秒时间戳，前端据此提前刷新 */
  accessTokenExpiresAt: number
}

export interface LoginResult extends TokenPair {
  user: AuthenticatedUser
}
