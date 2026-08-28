/**
 * 把模型返回的「人写的」值归一成系统内部格式。
 *
 * 刻意放在本地做而不是全指望提示词：模型偶尔会返回「2026年8月1日」
 * 或「壹拾贰万元整」，与其反复调提示词祈祷它守规矩，不如在这里兜住。
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0,
  一: 1, 壹: 1,
  二: 2, 贰: 2, 两: 2,
  三: 3, 叁: 3, 参: 3,
  四: 4, 肆: 4,
  五: 5, 伍: 5,
  六: 6, 陆: 6,
  七: 7, 柒: 7,
  八: 8, 捌: 8,
  九: 9, 玖: 9,
}

const CN_SMALL_UNITS: Record<string, number> = {
  十: 10, 拾: 10,
  百: 100, 佰: 100,
  千: 1000, 仟: 1000,
}

/** 中文数字 → 数值。支持大小写混写，如「贰佰叁拾捌万陆仟」。 */
function chineseSectionToNumber(s: string): number | null {
  let total = 0
  let section = 0
  let number = 0
  let sawAny = false

  for (const ch of s) {
    if (ch in CN_DIGITS) {
      number = CN_DIGITS[ch]!
      sawAny = true
      continue
    }
    const small = CN_SMALL_UNITS[ch]
    if (small !== undefined) {
      // 「十二」这种省略了前导一的写法，number 为 0 时按 1 算
      section += (number === 0 ? (small === 10 ? 1 : 0) : number) * small
      number = 0
      sawAny = true
      continue
    }
    if (ch === '万' || ch === '萬') {
      section = (section + number) * 10_000
      total += section
      section = 0
      number = 0
      sawAny = true
      continue
    }
    if (ch === '亿' || ch === '億') {
      total = (total + section + number) * 100_000_000
      section = 0
      number = 0
      sawAny = true
      continue
    }
    // 其他字符（元、整、空格…）忽略
  }

  if (!sawAny) return null
  return total + section + number
}

/**
 * 金额 → '123456.78' 形式的字符串。
 *
 * 认得：1,234.56 / ¥1234 / 人民币 12 万元 / 壹拾贰万元整 / 壹佰贰拾叁元肆角伍分
 * 认不出来返回 null（宁可留空让人填，也不要猜一个错的金额）。
 */
export function normalizeAmount(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw.toFixed(2) : null
  }
  if (typeof raw !== 'string') return null

  let s = raw.trim()
  if (s === '') return null

  // 去掉币种符号、千分位、空白
  s = s.replace(/[,，\s]/g, '').replace(/^(人民币|RMB|CNY|¥|￥|\$|USD|EUR|€|HKD|HK\$)/i, '')

  // 纯阿拉伯数字（可能带「元」「万元」）
  const arabic = /^(\d+(?:\.\d+)?)(万|萬|亿|億)?(?:元|圆|块)?(?:整|正)?$/.exec(s)
  if (arabic) {
    let n = Number(arabic[1])
    if (arabic[2] === '万' || arabic[2] === '萬') n *= 10_000
    if (arabic[2] === '亿' || arabic[2] === '億') n *= 100_000_000
    return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null
  }

  // 中文大写：先按「元 / 圆」拆出整数部分和角分
  const yuanIdx = Math.max(s.indexOf('元'), s.indexOf('圆'))
  const intPart = yuanIdx >= 0 ? s.slice(0, yuanIdx) : s
  const fracPart = yuanIdx >= 0 ? s.slice(yuanIdx + 1) : ''

  const integer = chineseSectionToNumber(intPart)
  if (integer === null) return null

  let cents = 0
  const jiao = /([零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖])角/.exec(fracPart)
  const fen = /([零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖])分/.exec(fracPart)
  if (jiao) cents += (CN_DIGITS[jiao[1]!] ?? 0) * 10
  if (fen) cents += CN_DIGITS[fen[1]!] ?? 0

  const value = integer + cents / 100
  if (!Number.isFinite(value) || value < 0 || value > 1e16) return null
  return value.toFixed(2)
}

/**
 * 日期 → 'YYYY-MM-DD'。
 *
 * 认得：2026-08-01 / 2026/8/1 / 2026.08.01 / 2026年8月1日 / 20260801
 * 认不出来或明显不合理（月份 13、日 32）返回 null。
 */
export function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s === '') return null

  let y: number | undefined
  let m: number | undefined
  let d: number | undefined

  const sep = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?$/.exec(s)
  if (sep) {
    y = Number(sep[1])
    m = Number(sep[2])
    d = Number(sep[3])
  } else {
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
    if (compact) {
      y = Number(compact[1])
      m = Number(compact[2])
      d = Number(compact[3])
    }
  }

  if (y === undefined || m === undefined || d === undefined) return null
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null

  // 用 Date 反查，挡掉 2026-02-30 这类不存在的日期
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null
  }

  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(m)}-${p(d)}`
}

/** 去掉多余空白，并把长文本截断到字段上限 */
export function normalizeText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/\s+/g, ' ').trim()
  if (s === '') return null
  return s.length > maxLength ? s.slice(0, maxLength) : s
}
