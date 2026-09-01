import * as mupdf from 'mupdf'
import type { RedactionRect } from '@contract/shared'

/**
 * 涂抹：把不该出网的区域从「送去识别的副本」里真的抠掉。
 *
 * ⚠️ 这个文件是安全边界。改之前先读 docs/design/04 §2。
 *
 * 核心事实：**在 PDF 上画黑框不等于涂掉**。本系统对电子版 PDF 走文本层路径，
 * 界面上画的框对送出去的文字毫无影响 —— 必须按坐标把字符真的剔掉。
 * 两条路径的实现完全不同：
 *
 *   文本路径 → 逐字符判断落不落在涂抹框里，落在里面的丢弃
 *   图像路径 → 渲染后把对应像素填成纯黑
 */

/** 页面坐标系（point）里的矩形 */
interface PageRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 归一化坐标（0–1）→ 该页的 point 坐标 */
export function toPageRects(
  rects: RedactionRect[],
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
): PageRect[] {
  return rects
    .filter((r) => r.page === pageIndex)
    .map((r) => ({
      x0: r.x * pageWidth,
      y0: r.y * pageHeight,
      x1: (r.x + r.w) * pageWidth,
      y1: (r.y + r.h) * pageHeight,
    }))
}

/**
 * 字符是否落在任一涂抹框里。
 *
 * 判定用**字符外框与涂抹框相交**，而不是「中心点在框内」——
 * 用户框住半个字时，那个字也必须被抠掉。宁可多抠一点，也不能漏。
 */
function charHit(quad: number[], rects: PageRect[]): boolean {
  // quad 是四个角：[x0,y0, x1,y1, x2,y2, x3,y3]
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!]
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!]
  const cx0 = Math.min(...xs)
  const cx1 = Math.max(...xs)
  const cy0 = Math.min(...ys)
  const cy1 = Math.max(...ys)
  return rects.some((r) => cx0 < r.x1 && cx1 > r.x0 && cy0 < r.y1 && cy1 > r.y0)
}

/**
 * 抽一页的文本，逐字符跳过被涂抹的部分。
 *
 * 用 walk 而不是 asJSON：asJSON 只给到**行级** bbox，那样只能整行删掉 ——
 * 合同里金额通常嵌在句子中间，整行删会把上下文一起删没，人工补填时就没法
 * 对照了。walk 能拿到每个字的 quad，可以精确抠。
 */
export function extractPageTextRedacted(
  page: mupdf.Page,
  rects: PageRect[],
): string {
  const lines: string[] = []
  let current = ''
  let redactedInLine = 0

  page.toStructuredText('preserve-whitespace').walk({
    beginLine() {
      current = ''
      redactedInLine = 0
    },
    endLine() {
      // 被抠掉的地方留一个记号，让模型和人都知道这里原本有内容、
      // 而不是以为合同本来就没写。也避免「金额：」后面直接接下一句造成误读。
      const line = redactedInLine > 0 ? `${current}〔已涂抹〕` : current
      if (line.trim()) lines.push(line)
      current = ''
      redactedInLine = 0
    },
    onChar(c: string, _origin: unknown, _font: unknown, _size: number, quad: number[]) {
      if (rects.length > 0 && charHit(quad, rects)) {
        redactedInLine++
        return
      }
      current += c
    },
  } as never)

  return lines.join('\n')
}

/* ── 金额检测 ──────────────────────────────────────────────────────── */

/**
 * 中文合同的金额几乎总是写两遍：大写一遍、阿拉伯数字一遍，而且常在同一行的
 * 不同位置。用户框住其中一个，很容易以为金额已经涂干净了 —— 另一个照样出网。
 *
 * 所以预览时把所有「看着像金额」的位置都标出来，让人一眼看见有几处、
 * 并且能一键全涂。这是这个功能最容易出事的地方，值得多做一步。
 */
const AMOUNT_PATTERNS: RegExp[] = [
  // 带千分位或两位小数的阿拉伯数字：128,600.00 / 1,200 / 48000.00
  /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}\b/g,
  // 中文大写金额：至少 3 个大写数字/单位连着，且带「元/万/仟/佰/拾」之一
  /[零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]{3,}/g,
]

/** 中文大写串里必须出现这些之一，否则「零零零」这种也会被当成金额 */
const CN_AMOUNT_ANCHOR = /[元圆万仟佰拾亿]/

export interface DetectedAmount {
  /** 检测到的原文，给用户看「涂的是这个」 */
  text: string
  /** 归一化坐标（0–1），可直接当涂抹框用 */
  x: number
  y: number
  w: number
  h: number
}

/**
 * 找出一页里所有像金额的文本及其位置。**纯本地，不出网。**
 *
 * 只是提示，不自动涂 —— 自动涂会把「税率 13%」这种也涂掉，
 * 该涂什么终究得人来定。
 */
export function detectAmounts(
  page: mupdf.Page,
  pageWidth: number,
  pageHeight: number,
): DetectedAmount[] {
  let buf = ''
  const quads: number[][] = []
  page.toStructuredText('preserve-whitespace').walk({
    onChar(c: string, _o: unknown, _f: unknown, _s: number, quad: number[]) {
      buf += c
      quads.push(quad)
    },
  } as never)

  const found: DetectedAmount[] = []
  const seen = new Set<string>()

  for (const pattern of AMOUNT_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(buf)) !== null) {
      const text = m[0]
      // 中文大写串要有货币锚点，否则「一二三」也会中招
      if (/[零壹贰叁肆伍陆柒捌玖]/.test(text) && !CN_AMOUNT_ANCHOR.test(text)) continue

      const hit = quads.slice(m.index, m.index + text.length)
      if (hit.length === 0) continue
      const xs = hit.flatMap((q) => [q[0]!, q[2]!, q[4]!, q[6]!])
      const ys = hit.flatMap((q) => [q[1]!, q[3]!, q[5]!, q[7]!])
      const pad = 1.5 // 留点余量，跟人手拉框的习惯一致
      const rect = {
        text,
        x: Math.max(0, (Math.min(...xs) - pad) / pageWidth),
        y: Math.max(0, (Math.min(...ys) - pad) / pageHeight),
        w: Math.min(1, (Math.max(...xs) - Math.min(...xs) + pad * 2) / pageWidth),
        h: Math.min(1, (Math.max(...ys) - Math.min(...ys) + pad * 2) / pageHeight),
      }
      // 同一处可能被两个模式都命中，按位置去重
      const key = `${rect.x.toFixed(4)},${rect.y.toFixed(4)}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push(rect)
    }
  }

  return found
}

/**
 * 在已渲染的 pixmap 上把涂抹区域填成纯黑。
 *
 * pixmap 的 bbox 原点不一定是 (0,0)（分块渲染时每块有自己的原点），
 * 所以要减去原点再定位像素。
 */
export function paintRedactions(
  pixmap: mupdf.Pixmap,
  rects: PageRect[],
  scale: number,
  tileOriginX: number,
  tileOriginY: number,
): void {
  if (rects.length === 0) return

  const pixels = pixmap.getPixels()
  const width = pixmap.getWidth()
  const height = pixmap.getHeight()
  const comps = pixmap.getNumberOfComponents()

  for (const r of rects) {
    // 页面坐标 → 设备坐标 → 该块内的像素坐标
    const x0 = Math.max(0, Math.floor(r.x0 * scale) - tileOriginX)
    const y0 = Math.max(0, Math.floor(r.y0 * scale) - tileOriginY)
    const x1 = Math.min(width, Math.ceil(r.x1 * scale) - tileOriginX)
    const y1 = Math.min(height, Math.ceil(r.y1 * scale) - tileOriginY)
    if (x1 <= x0 || y1 <= y0) continue // 这块没被这个矩形碰到

    for (let y = y0; y < y1; y++) {
      const rowStart = y * width
      for (let x = x0; x < x1; x++) {
        const base = (rowStart + x) * comps
        for (let c = 0; c < comps; c++) pixels[base + c] = 0
      }
    }
  }
}
