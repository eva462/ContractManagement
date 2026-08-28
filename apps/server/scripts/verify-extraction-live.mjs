#!/usr/bin/env node
/**
 * 真实调用识别服务，用已知答案的样本合同验准确率。
 *
 * ⚠️ 会真的把样本合同发到厂商服务器，并产生少量费用（约 ¥0.02/份）。
 *    样本是脚本生成的假合同，不含任何真实数据。
 *
 *   npm run verify:live -w apps/server
 */
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
process.chdir(resolve(here, '..'))

const { loadDocument } = await import('../src/extraction/document-loader.ts')
const { resolveExtractor } = await import('../src/extraction/providers.ts')
const { EXPECTED } = await import('./make-sample-contract.mjs')

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
}

const LABEL = {
  contractNo: '合同编号',
  title: '合同名称',
  contractType: '合同类型',
  counterpartyName: '对方单位',
  counterpartyContact: '对方联系人',
  amountType: '金额类型',
  amount: '合同金额',
  currency: '币种',
  signDate: '签订日期',
  effectiveDate: '生效日期',
  expiryDate: '到期日期',
  paymentTerms: '付款方式',
  isPerpetual: '长期有效',
}

const width = (s) => [...String(s)].reduce((n, c) => n + (/[一-龥（）：，。？！]/.test(c) ? 2 : 1), 0)
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - width(s)))

const extractor = resolveExtractor()
if (!extractor.status().available) {
  console.error(C.r('识别服务不可用：') + extractor.status().reason)
  process.exit(1)
}

const files = [
  resolve(root, 'var/sample/电子版合同.pdf'),
  resolve(root, 'var/sample/扫描件合同.pdf'),
]
for (const f of files) {
  if (!existsSync(f)) {
    console.error(C.r('样本不存在：') + f + '\n先运行 node scripts/make-sample-contract.mjs')
    process.exit(1)
  }
}

console.log(C.b('\n真实识别验证') + C.dim(`   供应商：${extractor.name}`))
console.log(C.dim('样本是脚本生成的假合同；本次会真实调用接口并产生少量费用\n'))

const results = []

for (const file of files) {
  const name = basename(file)
  const doc = loadDocument({
    buffer: readFileSync(file),
    mimeType: 'application/pdf',
    fileName: name,
  })

  process.stdout.write(
    C.b(`━━━ ${name} `) +
      C.dim(`(${doc.mode === 'text' ? '文本路径' : `图片路径 · ${doc.images.length} 张切图`})`) +
      C.dim(' 识别中…'),
  )

  let out
  try {
    out = await extractor.extract(doc)
  } catch (err) {
    console.log('\r' + C.r(`━━━ ${name} 识别失败：`) + (err?.message ?? err) + ' '.repeat(20))
    continue
  }
  console.log('\r' + ' '.repeat(90) + '\r' + C.b(`━━━ ${name}`) +
    C.dim(`  ${out.meta.mode === 'text' ? '文本路径' : `图片路径 · ${out.meta.imageCount} 张切图`} · ${out.meta.model} · ${(out.meta.elapsedMs / 1000).toFixed(1)}s`))

  let right = 0
  let wrong = 0
  let missed = 0

  console.log()
  console.log('  ' + pad('字段', 14) + pad('期望', 26) + pad('识别结果', 26) + '判定')
  console.log('  ' + C.dim('─'.repeat(76)))

  for (const [key, expected] of Object.entries(EXPECTED)) {
    const got = out.fields[key]
    const value = got?.value ?? null
    let verdict
    if (value === null) {
      missed++
      verdict = C.y('未识别')
    } else if (String(value) === String(expected)) {
      right++
      verdict = C.g('✓')
      if (got.confidence === 'low') verdict += C.dim(' (低置信)')
    } else {
      wrong++
      verdict = C.r('✗ 错')
    }
    console.log(
      '  ' + pad(LABEL[key] ?? key, 14) + C.dim(pad(expected, 26)) +
      pad(value === null ? '—' : String(value), 26) + verdict,
    )
  }

  // 额外识别到但不在对答案范围内的字段
  const extra = Object.keys(out.fields).filter((k) => !(k in EXPECTED))
  if (extra.length) {
    console.log('  ' + C.dim(`另外识别到：${extra.map((k) => LABEL[k] ?? k).join('、')}`))
  }

  const total = Object.keys(EXPECTED).length
  console.log(
    `\n  ${C.g(`正确 ${right}`)} / ${C.r(`错误 ${wrong}`)} / ${C.y(`未识别 ${missed}`)}` +
      C.dim(`   共 ${total} 项  准确率 ${((right / total) * 100).toFixed(0)}%`) + '\n',
  )

  results.push({ name, right, wrong, missed, total, mode: out.meta.mode })
}

console.log(C.dim('─'.repeat(78)))
for (const r of results) {
  const tag = r.wrong === 0 && r.missed === 0 ? C.g('全对') : r.wrong === 0 ? C.y('有遗漏但无错值') : C.r('有错值')
  console.log(`  ${pad(r.name, 24)} ${pad(r.mode === 'text' ? '文本路径' : '图片路径', 12)} ${tag}` +
    C.dim(`  ${r.right}/${r.total}`))
}
console.log()
console.log(C.dim('  注：合同系统里「错值」比「未识别」危险得多 —— 未识别只是要人补填，'))
console.log(C.dim('      错值如果核对时看漏就会直接进库。'))
