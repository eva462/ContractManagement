import type { ExtractedFields, ExtractionResult, ExtractionStatus } from '@contract/shared'
import { env } from '../env.js'
import type { LoadedDocument } from './document-loader.js'
import { extractJsonObject, validateAndNormalize } from './parse.js'
import { SYSTEM_PROMPT, buildUserContent, type ChatContentPart } from './prompt.js'
import type { FieldExtractor } from './provider.js'

/**
 * OpenAI 兼容协议的通用识别客户端。
 *
 * DeepSeek 和阿里云百炼（通义千问）都实现了 /chat/completions 这套协议，
 * 差别只在 base URL、模型名和少数几个可选参数上。做成一个类 + 几份配置，
 * 比复制两份实现更容易保证「对比准确率时比的是模型，不是我的代码」。
 */

export interface ProviderConfig {
  /** 供应商标识，会写进留痕 */
  name: string
  baseUrl: string
  apiKey: string
  /** 处理 PDF 文本层时用的模型 */
  textModel: string
  /** 处理扫描件图片时用的模型 */
  visionModel: string
  /**
   * 是否支持 response_format: {type:'json_object'}。
   * 不支持时只靠提示词约束，解析端会容忍 markdown 围栏和多余的说明文字。
   */
  jsonMode: boolean
}

/** 模型返回不可用（空内容 / 非法 JSON / 一个字段都没抽到）时的重试次数 */
const MAX_ATTEMPTS = 3

interface ChatMessage {
  role: 'system' | 'user'
  content: string | ChatContentPart[]
}

export class OpenAiCompatibleExtractor implements FieldExtractor {
  readonly name: string
  private readonly endpoint: string

  constructor(private readonly config: ProviderConfig) {
    this.name = config.name
    this.endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  }

  status(): ExtractionStatus {
    return { available: true, provider: this.name }
  }

  async extract(doc: LoadedDocument, signal?: AbortSignal): Promise<ExtractionResult> {
    const startedAt = Date.now()
    const model = doc.mode === 'text' ? this.config.textModel : this.config.visionModel

    let fields: ExtractedFields = {}
    let lastError: string | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        fields = validateAndNormalize(await this.callModel(doc, model, attempt, signal))
        if (Object.keys(fields).length > 0) break
        lastError = '模型没有返回任何可用字段'
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (signal?.aborted) throw err
        if (attempt === MAX_ATTEMPTS) throw err
      }
    }

    if (Object.keys(fields).length === 0 && lastError) {
      // 不抛错：识别不出内容是正常结果（比如传了张风景照），
      // 让用户看到「没识别出字段」而不是一个红色报错
      console.warn(`[extraction:${this.name}] 未识别出字段：${lastError}`)
    }

    const values = Object.values(fields)
    return {
      fields,
      meta: {
        model,
        mode: doc.mode,
        pageCount: doc.pageCount,
        imageCount: doc.mode === 'vision' ? doc.images.length : 0,
        elapsedMs: Date.now() - startedAt,
        fieldCount: values.length,
        lowConfidenceCount: values.filter((f) => f.confidence === 'low').length,
      },
    }
  }

  private async callModel(
    doc: LoadedDocument,
    model: string,
    attempt: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(doc, attempt) },
    ]

    // 自带超时，避免模型卡住时前端一直转圈
    const timeout = AbortSignal.timeout(env.extractionTimeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(this.config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        // 抽取任务要的是确定性，不要发挥
        temperature: 0,
        max_tokens: 4000,
      }),
      signal: combined,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${this.name} 的 API key 无效或已过期`)
      }
      if (res.status === 429) {
        throw new Error(`${this.name} 接口限流，请稍后再试`)
      }
      throw new Error(`${this.name} 接口返回 ${res.status}：${body.slice(0, 200)}`)
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = json.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('模型返回了空内容')

    return extractJsonObject(content)
  }
}

/** 没配任何 key 时的空实现：接口照常在，只是不可用。系统其余部分完全不受影响。 */
export class NullExtractor implements FieldExtractor {
  readonly name = 'none'

  status(): ExtractionStatus {
    return {
      available: false,
      provider: this.name,
      reason: '未配置识别服务的 API key，内容识别不可用，可继续手工录入',
    }
  }

  async extract(): Promise<ExtractionResult> {
    throw new Error('内容识别未启用')
  }
}
