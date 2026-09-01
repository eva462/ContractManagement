import { env } from '../env.js'
import {
  NullExtractor,
  OpenAiCompatibleExtractor,
  type ProviderConfig,
} from './openai-compatible.js'
import type { FieldExtractor } from './provider.js'

/**
 * 各家识别服务的配置。
 *
 * 模型名一律走环境变量，默认值只是「我写这段代码时的当前型号」——
 * 各家改名换代很快，不要把它当成硬事实。真要用的时候以控制台里
 * 实际可用的型号为准，改 .env 即可，不用动代码。
 */

export const PROVIDER_IDS = ['deepseek', 'qwen'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  deepseek: 'DeepSeek',
  qwen: '通义千问（阿里云百炼）',
}

function configFor(id: ProviderId): ProviderConfig | null {
  if (id === 'deepseek') {
    if (!env.deepseekApiKey) return null
    return {
      name: 'deepseek',
      baseUrl: env.deepseekBaseUrl,
      apiKey: env.deepseekApiKey,
      textModel: env.deepseekTextModel,
      visionModel: env.deepseekVisionModel,
      // DeepSeek 明确支持 response_format: json_object
      jsonMode: true,
    }
  }

  if (!env.dashscopeApiKey) return null
  return {
    name: 'qwen',
    baseUrl: env.dashscopeBaseUrl,
    apiKey: env.dashscopeApiKey,
    textModel: env.qwenTextModel,
    visionModel: env.qwenVisionModel,
    // 百炼兼容模式对 response_format 的支持没有明确文档，
    // 默认关掉只靠提示词约束；解析端能容忍 markdown 围栏和多余文字。
    // 确认支持后把 QWEN_JSON_MODE=true 打开即可。
    jsonMode: env.qwenJsonMode,
  }
}

/**
 * 当前生效的供应商配置。风险审查也要调模型，但它不走 FieldExtractor 接口
 * （那是「文档 → 字段」专用的），所以直接把配置拿出来用底层 JSON 调用。
 */
export function activeProviderConfig(): ProviderConfig | null {
  const preferred = env.extractionProvider as ProviderId | ''
  if (preferred) return configFor(preferred)
  for (const id of PROVIDER_IDS) {
    const c = configFor(id)
    if (c) return c
  }
  return null
}

export function buildExtractor(id: ProviderId): FieldExtractor | null {
  const config = configFor(id)
  return config ? new OpenAiCompatibleExtractor(config) : null
}

/**
 * 按 EXTRACTION_PROVIDER 选一家。
 * 留空时自动挑一个配了 key 的；都没配就返回 NullExtractor（识别功能整体关闭）。
 */
export function resolveExtractor(): FieldExtractor {
  const preferred = env.extractionProvider as ProviderId | ''

  if (preferred) {
    const chosen = buildExtractor(preferred)
    if (chosen) return chosen
    console.warn(
      `[extraction] EXTRACTION_PROVIDER=${preferred}，但没配对应的 API key，识别功能已关闭`,
    )
    return new NullExtractor()
  }

  for (const id of PROVIDER_IDS) {
    const auto = buildExtractor(id)
    if (auto) return auto
  }
  return new NullExtractor()
}

/** 对比脚本用：返回所有配好了 key 的实现 */
export function availableExtractors(): { id: ProviderId; extractor: FieldExtractor }[] {
  return PROVIDER_IDS.map((id) => ({ id, extractor: buildExtractor(id) })).filter(
    (x): x is { id: ProviderId; extractor: FieldExtractor } => x.extractor !== null,
  )
}
