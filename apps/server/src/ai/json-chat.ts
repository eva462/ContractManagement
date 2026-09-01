import { env } from '../env.js'
import { extractJsonObject } from '../extraction/parse.js'
import type { ChatContentPart } from '../extraction/prompt.js'

/**
 * OpenAI 兼容协议的「要一段 JSON 回来」的底层调用。
 *
 * 字段识别和风险审查都用它，省得两处各写一遍 fetch、错误翻译和 JSON 兜底。
 * **它不知道任何业务语义** —— 提示词和校验由调用方负责。
 */

export interface JsonChatConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  /** 是否支持 response_format: json_object。不支持时只靠提示词约束。 */
  jsonMode: boolean
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string | ChatContentPart[]
}

export async function callJsonModel(
  config: JsonChatConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  // 自带超时，避免模型卡住时调用方一直挂着
  const timeout = AbortSignal.timeout(env.extractionTimeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      // 抽取和审查都要确定性，不要发挥
      temperature: 0,
      max_tokens: opts.maxTokens ?? 4000,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${config.name} 的 API key 无效或已过期`)
    }
    if (res.status === 429) {
      throw new Error(`${config.name} 接口限流，请稍后再试`)
    }
    throw new Error(`${config.name} 接口返回 ${res.status}：${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = json.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('模型返回了空内容')

  return extractJsonObject(content)
}
