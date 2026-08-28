/**
 * ★ API 地址可替换边界
 *
 * 全项目只有这里知道后端在哪。业务代码一律通过 api/client.ts 发请求，
 * 不许出现第二个写死的 host。
 *
 * 现在：本地开发 http://localhost:3000
 * 以后：改根目录 .env 的 VITE_API_BASE_URL 即可指向任意地址；
 *       打包成 App 时同样只改这个变量，代码不动。
 */
const raw = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export const API_BASE_URL = raw.replace(/\/+$/, '')
export const API_PREFIX = `${API_BASE_URL}/api/v1`
