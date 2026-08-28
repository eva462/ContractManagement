import { buildApp } from './app.js'
import { initInfrastructure } from './context.js'
import { db } from './db.js'
import { env } from './env.js'

async function main(): Promise<void> {
  await initInfrastructure()

  const app = buildApp()
  await app.listen({ port: env.port, host: env.host })

  app.log.info(`附件目录 ${env.uploadDir}`)
  app.log.info(`允许的前端来源 ${env.corsOrigin}`)
  app.log.info(`合同可见范围 ${env.contractVisibility}`)

  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    await app.close()
    await db.$disconnect()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('服务启动失败：', err)
  process.exit(1)
})
