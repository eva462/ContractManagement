#!/usr/bin/env node
/**
 * 把「真正发给识别服务的那份内容」原样打印出来 —— 涂抹前后各一份。
 *
 * 这不是测试，是给人看的证据：不用信我说的，自己看发出去的到底是什么。
 * 纯本地，不调任何接口。
 *
 *   npm run show:redaction -w apps/server
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(resolve(here, '..'))
const root = resolve(here, '../../..')

const { loadDocument } = await import('../src/extraction/document-loader.ts')

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
}

/** 找一段文字在页面上的位置，用来当涂抹框 */
function locate(pdf, needle) {
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf')
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p)
    const [bx0, by0, bx1, by1] = page.getBounds()
    let buf = ''
    const quads = []
    page.toStructuredText('preserve-whitespace').walk({
      onChar(c, _o, _f, _s, q) {
        buf += c
        quads.push(q)
      },
    })
    const i = buf.indexOf(needle)
    if (i < 0) continue
    const hit = quads.slice(i, i + needle.length)
    const xs = hit.flatMap((q) => [q[0], q[2], q[4], q[6]])
    const ys = hit.flatMap((q) => [q[1], q[3], q[5], q[7]])
    // 上下各留一点余量，跟人手拉框的习惯一致
    const pad = 2
    return {
      page: p,
      x: (Math.min(...xs) - pad) / (bx1 - bx0),
      y: (Math.min(...ys) - pad) / (by1 - by0),
      w: (Math.max(...xs) - Math.min(...xs) + pad * 2) / (bx1 - bx0),
      h: (Math.max(...ys) - Math.min(...ys) + pad * 2) / (by1 - by0),
    }
  }
  return null
}

/** 把命中的关键词高亮出来，一眼能看见在不在 */
function mark(text, needles) {
  let out = text
  for (const n of needles) out = out.split(n).join(C.r(`【${n}】`))
  return out
}

const textPdfPath = resolve(root, 'var/sample/电子版合同.pdf')
const scanPdfPath = resolve(root, 'var/sample/扫描件合同.pdf')
if (!existsSync(textPdfPath)) {
  console.error('样本不存在，先跑 npm run sample -w apps/server')
  process.exit(1)
}
const textPdf = readFileSync(textPdfPath)

/* ── 电子版 PDF：走文本路径 ─────────────────────────────────────── */

const plain = loadDocument({ buffer: textPdf, mimeType: 'application/pdf', fileName: 's.pdf' })
const NEEDLES = ['128,600.00', '壹拾贰万捌仟陆佰元整', '128,600']
  .filter((n) => plain.mode === 'text' && plain.text.includes(n))

console.log(C.b('\n电子版 PDF —— 发给识别服务的是「文本」，不是图片'))
console.log(C.dim('  所以这里不存在「遮住」，是字符被直接删掉了。\n'))

console.log(C.y('【涂抹前】发出去的正文，含金额那几行：'))
const beforeLines = (plain.mode === 'text' ? plain.text : '').split('\n')
for (const l of beforeLines) {
  if (NEEDLES.some((n) => l.includes(n))) console.log('  ' + mark(l, NEEDLES))
}

const { detectSensitive } = await import('../src/extraction/redact.ts')
const probeDoc = mupdf.Document.openDocument(textPdf, 'application/pdf')
const probePage = probeDoc.loadPage(0)
const [pbx0, pby0, pbx1, pby1] = probePage.getBounds()
const detected = detectSensitive(probePage, pbx1 - pbx0, pby1 - pby0)
console.log(
  C.dim(`  （系统检测到 ${detected.length} 处金额：${detected.map((d) => d.text).join('、')}）
`),
)
const boxes = detected.map((d) => ({ page: 0, x: d.x, y: d.y, w: d.w, h: d.h }))
const box = boxes[0] ?? locate(textPdf, NEEDLES[0])
const redacted = loadDocument({
  buffer: textPdf,
  mimeType: 'application/pdf',
  fileName: 's.pdf',
  redactions: boxes,
})
const afterText = redacted.mode === 'text' ? redacted.text : ''

console.log(
  '\n' +
    C.y('【涂抹后】同样位置的那几行') +
    C.dim(`（用界面上的「一键涂掉」，把检测到的 ${boxes.length} 处金额全涂了）：`),
)
const afterLines = afterText.split('\n')
for (const l of afterLines) {
  if (l.includes('已涂抹') || l.includes('金额') || l.includes('价款')) console.log('  ' + mark(l, NEEDLES))
}

console.log('\n' + C.b('  在整份发出去的正文里搜这几个词：'))
for (const n of NEEDLES) {
  const inBefore = (plain.mode === 'text' ? plain.text : '').includes(n)
  const inAfter = afterText.includes(n)
  console.log(
    `    「${n}」  涂抹前 ${inBefore ? C.r('在') : C.dim('不在')}   涂抹后 ${inAfter ? C.r('❗仍然在') : C.g('已消失')}`,
  )
}
console.log(
  C.dim(
    `\n  正文长度：${plain.mode === 'text' ? plain.text.length : 0} 字 → ${afterText.length} 字（其余内容原样保留，只少了框住的部分）`,
  ),
)

/* ── 扫描件：走图片路径 ─────────────────────────────────────────── */

if (existsSync(scanPdfPath)) {
  const scanPdf = readFileSync(scanPdfPath)
  const outDir = resolve(root, 'var/redaction-demo')
  mkdirSync(outDir, { recursive: true })

  const before = loadDocument({ buffer: scanPdf, mimeType: 'application/pdf', fileName: 'x.pdf' })
  const after = loadDocument({
    buffer: scanPdf,
    mimeType: 'application/pdf',
    fileName: 'x.pdf',
    // 涂掉左上角那一块的中间一条，方便肉眼对比
    redactions: [{ page: 0, x: 0.08, y: 0.30, w: 0.55, h: 0.10 }],
  })

  if (before.mode === 'vision' && after.mode === 'vision') {
    writeFileSync(resolve(outDir, '涂抹前.png'), before.images[0].data)
    writeFileSync(resolve(outDir, '涂抹后.png'), after.images[0].data)
    console.log(C.b('\n\n扫描件 —— 发给识别服务的是「图片」'))
    console.log(C.dim('  这里才是真的涂：对应像素被填成纯黑，图里没有那些像素了。\n'))
    console.log('  已导出两张图供对比：')
    console.log(C.dim(`    ${resolve(outDir, '涂抹前.png')}`))
    console.log(C.dim(`    ${resolve(outDir, '涂抹后.png')}`))
  }
}

console.log(
  '\n' +
    C.b('存档的原件不受影响') +
    C.dim(' —— 涂抹只作用于送去识别的那一份副本，存进系统的合同是完整的。\n'),
)
