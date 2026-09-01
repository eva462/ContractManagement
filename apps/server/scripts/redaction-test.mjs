#!/usr/bin/env node
/**
 * 涂抹的安全验证 —— 这是本仓库最不能出错的一组测试。
 *
 * 要证明的事只有一件：**涂抹之后，被涂的内容不会出现在送给 DeepSeek 的载荷里。**
 *
 * 「界面上黑了、实际照发」是文档脱敏最经典的事故。文本层路径尤其容易犯 ——
 * 画框根本不影响抽出来的文字。所以这里不看界面，直接搜最终载荷。
 *
 *   npm run test:redaction -w apps/server
 *
 * 纯本地，不调任何接口、不花钱。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(resolve(here, '..'))
const root = resolve(here, '../../..')

const { loadDocument } = await import('../src/extraction/document-loader.ts')

let passed = 0
let failed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`)
  }
}
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)

/** 在 PDF 里找一段文字，返回它归一化后的位置（用来当涂抹框） */
function locate(pdfBuffer, needle) {
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf')
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p)
    const [bx0, by0, bx1, by1] = page.getBounds()
    const pw = bx1 - bx0
    const ph = by1 - by0

    let buf = ''
    const quads = []
    page.toStructuredText('preserve-whitespace').walk({
      onChar(c, _o, _f, _s, quad) {
        buf += c
        quads.push(quad)
      },
    })

    const idx = buf.indexOf(needle)
    if (idx < 0) continue

    const hit = quads.slice(idx, idx + needle.length)
    const xs = hit.flatMap((q) => [q[0], q[2], q[4], q[6]])
    const ys = hit.flatMap((q) => [q[1], q[3], q[5], q[7]])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    return {
      page: p,
      x: x0 / pw,
      y: y0 / ph,
      w: (x1 - x0) / pw,
      h: (y1 - y0) / ph,
    }
  }
  return null
}

/** PNG 里某块区域是不是全黑 */
function regionIsBlack(pngBuffer, fracX, fracY, fracW, fracH) {
  const pix = new mupdf.Image(pngBuffer).toPixmap()
  const w = pix.getWidth()
  const h = pix.getHeight()
  const n = pix.getNumberOfComponents()
  const px = pix.getPixels()

  const x0 = Math.floor(fracX * w)
  const y0 = Math.floor(fracY * h)
  const x1 = Math.ceil((fracX + fracW) * w)
  const y1 = Math.ceil((fracY + fracH) * h)
  let checked = 0
  for (let y = y0; y < Math.min(y1, h); y++) {
    for (let x = x0; x < Math.min(x1, w); x++) {
      const base = (y * w + x) * n
      for (let c = 0; c < n; c++) {
        if (px[base + c] !== 0) return { black: false, checked }
      }
      checked++
    }
  }
  return { black: checked > 0, checked }
}

async function main() {
  console.log('\x1b[1m涂抹安全验证\x1b[0m\x1b[90m（纯本地，搜最终载荷）\x1b[0m')

  const textPdfPath = resolve(root, 'var/sample/电子版合同.pdf')
  const scanPdfPath = resolve(root, 'var/sample/扫描件合同.pdf')
  for (const p of [textPdfPath, scanPdfPath]) {
    if (!existsSync(p)) {
      console.error(`样本不存在：${p}\n先跑 npm run sample -w apps/server`)
      process.exit(1)
    }
  }
  const textPdf = readFileSync(textPdfPath)
  const scanPdf = readFileSync(scanPdfPath)

  /* ── A 文本路径 ─────────────────────────────────────────────── */
  section('A · 文本路径（电子版 PDF）')

  const plain = loadDocument({ buffer: textPdf, mimeType: 'application/pdf', fileName: 'a.pdf' })
  check('电子版走文本路径', plain.mode === 'text')

  // 从合同里挑一段真实存在的金额来涂
  const AMOUNT = ['128,600.00', '128600.00', '壹拾贰万捌仟陆佰元整', '128,600']
    .find((s) => plain.mode === 'text' && plain.text.includes(s))
  check('样本里找得到金额文本', !!AMOUNT, AMOUNT ?? `正文片段：${plain.mode === 'text' ? plain.text.slice(0, 60) : ''}`)
  if (!AMOUNT) {
    console.error('\n找不到可涂的金额，测试无法继续')
    process.exit(1)
  }

  const box = locate(textPdf, AMOUNT)
  check('能定位到它在页面上的坐标', box !== null, box ? `第 ${box.page + 1} 页` : '')

  const redacted = loadDocument({
    buffer: textPdf,
    mimeType: 'application/pdf',
    fileName: 'a.pdf',
    redactions: [box],
  })

  // 这一条就是整个功能的意义所在
  check(
    `\x1b[1m涂抹后载荷里搜不到「${AMOUNT}」\x1b[0m`,
    redacted.mode === 'text' && !redacted.text.includes(AMOUNT),
    redacted.mode === 'text' && redacted.text.includes(AMOUNT) ? '❗内容仍然出网' : '',
  )
  check(
    '留下了「已涂抹」记号（让人知道这里原本有内容）',
    redacted.mode === 'text' && redacted.text.includes('已涂抹'),
  )
  check(
    '其余正文没有被误删',
    redacted.mode === 'text' && redacted.text.includes('合同编号') && redacted.text.length > 200,
    redacted.mode === 'text' ? `剩余 ${redacted.text.length} 字` : '',
  )

  const untouched = loadDocument({
    buffer: textPdf,
    mimeType: 'application/pdf',
    fileName: 'a.pdf',
    redactions: [],
  })
  check(
    '不涂抹时内容完整（没有误伤）',
    untouched.mode === 'text' && untouched.text.includes(AMOUNT),
  )

  /* ── B 图像路径 ─────────────────────────────────────────────── */
  section('B · 图像路径（扫描件）')

  const scanPlain = loadDocument({ buffer: scanPdf, mimeType: 'application/pdf', fileName: 'b.pdf' })
  check('扫描件走图像路径', scanPlain.mode === 'vision')

  // 涂掉整个左上角 1/4 —— 正好等于第 0 块切图的范围，便于逐像素验证
  const quarter = { page: 0, x: 0, y: 0, w: 0.5, h: 0.5 }
  const scanRedacted = loadDocument({
    buffer: scanPdf,
    mimeType: 'application/pdf',
    fileName: 'b.pdf',
    redactions: [quarter],
  })
  check('切图数量不变', scanRedacted.mode === 'vision' && scanRedacted.images.length === scanPlain.images.length)

  const tile0 = scanRedacted.mode === 'vision' ? scanRedacted.images[0] : null
  const r0 = tile0 ? regionIsBlack(tile0.data, 0.1, 0.1, 0.8, 0.8) : { black: false, checked: 0 }
  check(
    '\x1b[1m被涂的那块切图确实是纯黑像素\x1b[0m',
    r0.black,
    `检查了 ${r0.checked} 个像素`,
  )

  const tile3 = scanRedacted.mode === 'vision' ? scanRedacted.images[3] : null
  const r3 = tile3 ? regionIsBlack(tile3.data, 0.1, 0.1, 0.8, 0.8) : { black: true, checked: 0 }
  check('没被涂的切图不受影响', !r3.black)

  /* ── C 边界 ─────────────────────────────────────────────────── */
  section('C · 边界情况')

  const wholePage = loadDocument({
    buffer: textPdf,
    mimeType: 'application/pdf',
    fileName: 'a.pdf',
    redactions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }],
  })
  check(
    '涂满整页后，该页一个字都不剩',
    wholePage.mode !== 'text' || !wholePage.text.includes('合同编号'),
    wholePage.mode === 'text' ? `剩余 ${wholePage.text.length} 字` : `退化成 ${wholePage.mode}`,
  )

  const otherPage = loadDocument({
    buffer: textPdf,
    mimeType: 'application/pdf',
    fileName: 'a.pdf',
    redactions: [{ page: 5, x: 0, y: 0, w: 1, h: 1 }],
  })
  check(
    '涂在不存在的页码上不影响本页内容',
    otherPage.mode === 'text' && otherPage.text.includes(AMOUNT),
  )

  /* ── D 金额检测 ─────────────────────────────────────────────────
   *
   * 中文合同的金额几乎总是写两遍（大写 + 阿拉伯数字），常在同一行不同位置。
   * 用户框住其中一个就以为涂干净了，另一个照样出网 —— 这是这个功能最容易
   * 出事的地方，所以专门检测出来提示。
   */
  section('D · 金额检测（防止只涂了一半）')

  const { detectAmounts } = await import('../src/extraction/redact.ts')
  const dDoc = mupdf.Document.openDocument(textPdf, 'application/pdf')
  const dPage = dDoc.loadPage(0)
  const [dx0, dy0, dx1, dy1] = dPage.getBounds()
  const found = detectAmounts(dPage, dx1 - dx0, dy1 - dy0)
  const texts = found.map((f) => f.text)

  check('检测到阿拉伯数字金额', texts.some((t) => t.includes('128,600')), texts.join(' / '))
  check('也检测到同一笔的中文大写金额', texts.some((t) => t.includes('壹拾贰万')), texts.join(' / '))
  check(
    '两者位置不同（正是只涂一个会漏的原因）',
    found.length >= 2 && new Set(found.map((f) => f.x.toFixed(3))).size >= 2,
  )
  check('没把税率百分比误判成金额', !texts.some((t) => t === '13' || t === '13%'), texts.join(' / '))

  const allBoxes = found.map((f) => ({ page: 0, x: f.x, y: f.y, w: f.w, h: f.h }))
  const allText = (() => {
    const d = loadDocument({
      buffer: textPdf,
      mimeType: 'application/pdf',
      fileName: 'a.pdf',
      redactions: allBoxes,
    })
    return d.mode === 'text' ? d.text : ''
  })()

  check(
    '\x1b[1m一键涂掉检测到的全部金额后，两种写法都消失\x1b[0m',
    !allText.includes('128,600') && !allText.includes('壹拾贰万'),
    allText.includes('128,600') ? '数字仍在' : allText.includes('壹拾贰万') ? '大写仍在' : '',
  )
  check('但合同其余内容还在', allText.includes('增值税') && allText.length > 600, `剩余 ${allText.length} 字`)

  console.log(`\n${'─'.repeat(60)}`)
  if (failed === 0) console.log(`\x1b[32m\x1b[1m全部通过\x1b[0m  ${passed} 项`)
  else {
    console.log(`\x1b[31m\x1b[1m${failed} 项失败\x1b[0m，${passed} 项通过\n`)
    for (const f of failures) console.log(`  \x1b[31m·\x1b[0m ${f}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\n\x1b[31m异常中断：\x1b[0m', e)
  process.exit(1)
})
