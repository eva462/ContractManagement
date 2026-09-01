import type { ExtractedFields, ExtractionResult, ExtractionStatus } from '@contract/shared'
import { callJsonModel, type ChatMessage } from '../ai/json-chat.js'
import type { LoadedDocument } from './document-loader.js'
import { validateAndNormalize } from './parse.js'
import { SYSTEM_PROMPT, buildUserContent } from './prompt.js'
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

export class OpenAiCompatibleExtractor implements FieldExtractor {
  readonly name: string

  constructor(private readonly config: ProviderConfig) {
    this.name = config.name
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
    return callJsonModel(
      {
        name: this.config.name,
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        model,
        jsonMode: this.config.jsonMode,
      },
      messages,
      { signal },
    )
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
