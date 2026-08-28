import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

export const db = new PrismaClient({
  log: env.isDev ? ['warn', 'error'] : ['error'],
})

/** 事务客户端类型。审计服务只接受它，从类型上保证留痕和业务写入在同一事务里。 */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
