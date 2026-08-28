import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ErrorCode, formatFileSize, type ApiFailure } from '@contract/shared'
import { env } from './env.js'
import { AppError } from './http/errors.js'
import { attachmentRoutes } from './modules/attachment/routes.js'
import { authRoutes } from './modules/auth/routes.js'
import { contractRoutes } from './modules/contract/routes.js'
import { extractionRoutes } from './modules/extraction/routes.js'
import { userRoutes } from './modules/user/routes.js'

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: env.isDev
      ? { transport: undefined, level: 'info' }
      : { level: 'warn' },
    // 反代后面才需要（ngrok / Cloudflare），本地开发关掉，免得 req.ip 被伪造的头污染
    trustProxy: env.trustProxy,
    bodyLimit: 1024 * 1024,
  })

  app.register(cors, {
    origin: env.corsOrigin.split(',').map((s) => s.trim()),
    credentials: false, // 用 Bearer Token，不依赖 Cookie
  })

  app.register(multipart, {
    limits: {
      fileSize: env.maxUploadBytes,
      files: 1,
      fields: 10,
    },
    throwFileSizeLimit: true,
  })

  app.get('/health', async () => ({ data: { ok: true, storage: env.storageDriver } }))

  app.register(authRoutes, { prefix: '/api/v1' })
  app.register(contractRoutes, { prefix: '/api/v1' })
  app.register(attachmentRoutes, { prefix: '/api/v1' })
  app.register(userRoutes, { prefix: '/api/v1' })
  app.register(extractionRoutes, { prefix: '/api/v1' })

  // 单源模式：后端同时托管前端。只在设了 SERVE_WEB_DIR 时启用，
  // 本地开发不受影响（前端仍跑 Vite dev server）。
  if (env.serveWebDir) {
    app.register(fastifyStatic, { root: env.serveWebDir, wildcard: false })
  }

  app.setNotFoundHandler((req, reply) => {
    // 接口路径找不到就老老实实返回 JSON 404，不要喂给它一个 HTML 首页
    const isApi = req.url.startsWith('/api') || req.url === '/health'
    if (env.serveWebDir && !isApi && req.method === 'GET') {
      // 其余 GET 一律回首页，交给前端路由（刷新 /contracts/xxx 才不会 404）
      return reply.type('text/html').sendFile('index.html')
    }
    const body: ApiFailure = {
      error: { code: ErrorCode.VALIDATION_FAILED, message: '接口不存在' },
    }
    reply.code(404).send(body)
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const body: ApiFailure = {
        error: { code: err.code, message: err.message, issues: err.issues },
      }
      return reply.code(err.status).send(body)
    }

    // multipart 在超限时会自己抛，翻译成我们的错误码和中文提示
    const code = (err as { code?: string }).code
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      const body: ApiFailure = {
        error: {
          code: ErrorCode.ATTACHMENT_TOO_LARGE,
          message: `文件超过 ${formatFileSize(env.maxUploadBytes)} 上限`,
        },
      }
      return reply.code(413).send(body)
    }
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
      const body: ApiFailure = {
        error: { code: ErrorCode.VALIDATION_FAILED, message: '请求不是有效的文件上传格式' },
      }
      return reply.code(400).send(body)
    }

    // 请求体不是合法 JSON。这是客户端的问题，不是服务器故障 ——
    // 之前会走到下面的兜底里变成 500，还把英文原文吐给了调用方。
    // 暴露到公网时扫描器会大量发畸形请求，不修的话日志全是假的 error。
    if (code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      const body: ApiFailure = {
        error: { code: ErrorCode.VALIDATION_FAILED, message: '请求体不是合法的 JSON' },
      }
      return reply.code(400).send(body)
    }

    // Fastify 自己抛的其他 4xx（如 415 不支持的 content-type）同样是客户端问题，
    // 照它给的状态码回，不要一律算成服务器故障
    const status = (err as { statusCode?: number }).statusCode
    if (typeof status === 'number' && status >= 400 && status < 500) {
      req.log.warn({ err }, 'client error')
      const body: ApiFailure = {
        error: { code: ErrorCode.VALIDATION_FAILED, message: '请求格式不正确' },
      }
      return reply.code(status).send(body)
    }

    // 剩下的都是没预料到的，日志里留全量，回给前端的只有一句话
    req.log.error({ err }, 'unhandled error')
    const detail = err instanceof Error ? err.message : String(err)
    const body: ApiFailure = {
      error: {
        code: ErrorCode.INTERNAL,
        message: env.isDev ? `服务器内部错误：${detail}` : '服务器内部错误',
      },
    }
    return reply.code(500).send(body)
  })

  return app
}
