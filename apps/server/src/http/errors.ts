import { ErrorCode, type FieldIssue } from '@contract/shared'

/** 所有可预期的业务错误都用它抛。未捕获的异常一律当 500 处理，不把内部信息透给前端。 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly issues?: FieldIssue[],
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const validationFailed = (issues: FieldIssue[]) =>
  new AppError(ErrorCode.VALIDATION_FAILED, '提交的内容有误，请检查标红的字段', 400, issues)

export const unauthorized = (message = '请先登录') =>
  new AppError(ErrorCode.UNAUTHORIZED, message, 401)

export const tokenExpired = () =>
  new AppError(ErrorCode.TOKEN_EXPIRED, '登录已过期，请重新登录', 401)

export const forbidden = (message = '没有权限执行此操作') =>
  new AppError(ErrorCode.FORBIDDEN, message, 403)

export const badCredentials = () =>
  new AppError(ErrorCode.BAD_CREDENTIALS, '用户名或密码不正确', 401)

export const notFound = (code: ErrorCode, message: string) => new AppError(code, message, 404)

export const conflict = (code: ErrorCode, message: string, issues?: FieldIssue[]) =>
  new AppError(code, message, 409, issues)

export const badRequest = (code: ErrorCode, message: string, issues?: FieldIssue[]) =>
  new AppError(code, message, 400, issues)
