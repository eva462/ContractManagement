/**
 * @contract/shared — 前后端唯一的接口契约。
 *
 * 后端用这里的 Zod schema 做运行时入参校验，前端从同一份 schema 推导 TypeScript 类型。
 * 改了字段，前端会立刻编译报错，不会等到运行时才发现。
 */

export * from './enums.js'
export * from './constants.js'
export * from './format.js'
export * from './schemas/common.js'
export * from './schemas/auth.js'
export * from './schemas/contract.js'
export * from './schemas/attachment.js'
export * from './schemas/audit.js'
export * from './schemas/extraction.js'
export * from './schemas/dict.js'
export * from './schemas/redaction.js'
export * from './schemas/review.js'
