import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 配置只有仓库根目录一份 .env，server 和 web 都从它读，避免两处配置漂移。
const here = dirname(fileURLToPath(import.meta.url))
const rootEnv = resolve(here, '../../../.env')
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv)
}

function required(key: string): string {
  const v = process.env[key]
  if (!v) {
    throw new Error(`缺少环境变量 ${key}。请从 .env.example 复制一份 .env 并填好。`)
  }
  return v
}

function optional(key: string, fallback: string): string {
  const v = process.env[key]
  return v === undefined || v === '' ? fallback : v
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key]
  if (v === undefined || v === '') return fallback
  return v === 'true' || v === '1'
}

function int(key: string, fallback: number): number {
  const v = process.env[key]
  if (!v) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`环境变量 ${key} 必须是数字，当前是 "${v}"`)
  return n
}

const uploadDir = optional('UPLOAD_DIR', './var/uploads')

export const env = {
  databaseUrl: required('DATABASE_URL'),

  port: int('PORT', 3000),
  host: optional('HOST', '127.0.0.1'),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),

  jwtSecret: required('JWT_SECRET'),
  accessTokenTtl: optional('ACCESS_TOKEN_TTL', '2h'),
  refreshTokenTtl: optional('REFRESH_TOKEN_TTL', '30d'),

  storageDriver: optional('STORAGE_DRIVER', 'local'),
  // 相对路径按仓库根目录解析，这样从哪个目录启动服务都指向同一个地方
  uploadDir: resolve(here, '../../..', uploadDir),
  maxUploadBytes: int('MAX_UPLOAD_MB', 50) * 1024 * 1024,
  maxAttachmentsPerContract: int('MAX_ATTACHMENTS_PER_CONTRACT', 20),

  // ─── 内容识别 ──────────────────────────────────────────────────
  // 一个 key 都不配也能正常跑，只是识别功能不可用（装配成 NullExtractor）。
  // 留空时自动挑一个配了 key 的供应商。
  extractionProvider: optional('EXTRACTION_PROVIDER', ''),
  // 实测单页合同走 v4-pro 就要 40 秒，多页只会更久。这里放宽到 3 分钟：
  // 前端有取消按钮，超时值大只影响「等多久才放弃」，不影响正常情况。
  extractionTimeoutMs: int('EXTRACTION_TIMEOUT_MS', 180_000),

  // DeepSeek
  deepseekApiKey: optional('DEEPSEEK_API_KEY', ''),
  // 可指向代理或镜像；测试时指向本地假服务
  deepseekBaseUrl: optional('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
  deepseekTextModel: optional('DEEPSEEK_TEXT_MODEL', 'deepseek-v4-pro'),
  deepseekVisionModel: optional('DEEPSEEK_VISION_MODEL', 'deepseek-v4-flash-vision-exp'),

  // 通义千问（阿里云百炼，OpenAI 兼容模式）
  // baseUrl 各地域不同，且新版控制台会带上 WorkspaceId，以控制台显示的为准
  dashscopeApiKey: optional('DASHSCOPE_API_KEY', ''),
  dashscopeBaseUrl: optional(
    'DASHSCOPE_BASE_URL',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ),
  qwenTextModel: optional('QWEN_TEXT_MODEL', 'qwen-plus'),
  qwenVisionModel: optional('QWEN_VISION_MODEL', 'qwen3-vl-plus'),
  qwenJsonMode: bool('QWEN_JSON_MODE', false),

  /** ALL = 全员可见全部合同；OWN = 非管理员只看自己经办的 */
  contractVisibility: optional('CONTRACT_VISIBILITY', 'ALL') as 'ALL' | 'OWN',

  /**
   * 单源模式：设成前端 dist 目录后，后端同时托管前端静态文件。
   * 这样一条隧道就能把整个系统暴露出去，前端也不用把 API 地址写死。
   * 本地日常开发不设这个，前后端还是各跑各的端口。
   */
  serveWebDir: optional('SERVE_WEB_DIR', ''),

  /** 放在 ngrok / Cloudflare 这类反代后面时要打开，否则 req.ip 全是反代的地址 */
  trustProxy: process.env.TRUST_PROXY === 'true',

  isDev: optional('NODE_ENV', 'development') !== 'production',
} as const

if (env.jwtSecret.length < 16) {
  throw new Error('JWT_SECRET 太短，至少 16 个字符。')
}
