import {
  EXTRACTABLE_FIELDS,
  EXTRACTED_FIELD_SCHEMAS,
  type Confidence,
  type ExtractableField,
  type ExtractedField,
  type ExtractedFields,
} from '@contract/shared'
import { normalizeAmount, normalizeDate, normalizeText } from './normalize.js'

/**
 * 模型返回值 → 干净的字段集合。与供应商无关，DeepSeek 和 Qwen 共用，
 * 保证对比准确率时比的是模型本身，不是各自的解析实现。
 */

/**
 * 从模型返回的文本里挖出 JSON 对象。
 *
 * 不是所有模型都支持 response_format 强制 json；不支持时它们常常会
 * 把 json 包在 ```json ... ``` 里，或者前后带一句「好的，以下是结果：」。
 * 这里一律容忍。
 */
export function extractJsonObject(content: string): Record<string, unknown> {
  let s = content.trim()

  // 去掉 markdown 代码围栏
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s)
  if (fenced) s = fenced[1]!.trim()

  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(text)
      return typeof v === 'object' && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  const direct = tryParse(s)
  if (direct) return direct

  // 还夹着别的话时，取第一个 { 到最后一个 } 之间的内容再试
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first >= 0 && last > first) {
    const sliced = tryParse(s.slice(first, last + 1))
    if (sliced) return sliced
  }

  throw new Error('模型返回的内容里找不到合法的 JSON 对象')
}

/**
 * 逐字段校验 + 归一。
 *
 * **单个字段不合规就丢掉那个字段**，不让整份结果作废 —— 识别出 9 个字段里
 * 有 1 个格式不对，剩下 8 个对用户仍然有用。
 */
export function validateAndNormalize(raw: Record<string, unknown>): ExtractedFields {
  const out: ExtractedFields = {}

  for (const field of EXTRACTABLE_FIELDS) {
    const entry = raw[field]
    if (entry === null || entry === undefined) continue

    // 模型有时会偷懒直接给裸值，而不是 {value, confidence, evidence}
    const wrapped =
      typeof entry === 'object' && entry !== null && 'value' in entry
        ? (entry as Record<string, unknown>)
        : { value: entry, confidence: 'medium', evidence: null }

    const normalizedValue = normalizeByField(field, wrapped.value)
    if (normalizedValue === null) continue

    const parsed = EXTRACTED_FIELD_SCHEMAS[field].safeParse({
      value: normalizedValue,
      confidence: wrapped.confidence,
      evidence: wrapped.evidence,
    })
    if (!parsed.success || parsed.data.value === null) continue

    out[field] = {
      value: parsed.data.value,
      confidence: parsed.data.confidence as Confidence,
      evidence: parsed.data.evidence,
    } as ExtractedField
  }

  return out
}

function normalizeByField(field: ExtractableField, value: unknown): unknown {
  switch (field) {
    case 'amount':
      return normalizeAmount(value)
    case 'signDate':
    case 'effectiveDate':
    case 'expiryDate':
      return normalizeDate(value)
    case 'isPerpetual':
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      return null
    case 'contractType':
    case 'amountType':
    case 'currency':
      return typeof value === 'string' ? value.trim().toUpperCase() : null
    case 'paymentTerms':
      return normalizeText(value, 2000)
    case 'title':
    case 'counterpartyName':
      return normalizeText(value, 255)
    case 'contractNo':
    case 'counterpartyContact':
      return normalizeText(value, 64)
    default:
      return normalizeText(value, 255)
  }
}
