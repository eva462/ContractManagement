#!/usr/bin/env node
/**
 * 用同一批合同对比各家识别服务的结果。
 *
 *   npm run compare -w apps/server -- ./合同1.pdf ./合同2.jpg
 *
 * 只跑配了 key 的供应商。配一家就是单家体检，配两家就是并排对比。
 * 重点看「不一致」那几行 —— 那是需要你翻原件核对的地方。
 *
 * ⚠️ 这个脚本会把文件发到对应厂商的服务器。
 */
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { loadDocument } from '../src/extraction/document-loader.js'
import { availableExtractors, PROVIDER_LABEL } from '../src/extraction/providers.js'
import { CONTRACT_FIELD_LABEL, EXTRACTABLE_FIELDS } from '@contract/shared'

const C = {
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * 显示宽度：中文按 2 算，并且要先剥掉 ANSI 颜色转义符 ——
 * 那些字符不占屏幕宽度，算进去表格会歪。
 */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')
const width = (s) =>
  [...stripAnsi(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)))

function renderCell(field) {
  if (!field || field.value === null) return C.dim('—')
  const v = String(field.value)
  const tag =
    field.confidence === 'high' ? '' : field.confidence === 'low' ? C.yellow('!') : C.dim('~')
  return v + (tag ? ' ' + tag : '')
}

async function runOne(path, extractors) {
  const ext = extname(path).toLowerCase()
  const mimeType = MIME_BY_EXT[ext]
  if (!mimeType) {
    console.log(C.red(`\n跳过 ${basename(path)}：不支持的扩展名 ${ext}`))
    return null
  }

  const buffer = readFileSync(path)
  const doc = loadDocument({ buffer, mimeType, fileName: basename(path) })

  const sizeKb = (statSync(path).size / 1024).toFixed(0)
  const how =
    doc.mode === 'text'
      ? `电子版 · ${doc.pageCount} 页 · 走文本层`
      : `扫描件 · ${doc.pageCount} 页 · ${doc.images.length} 张切图`
  console.log(`\n${C.bold('━━━ ' + basename(path) + ' ━━━')}  ${C.dim(`${sizeKb} KB · ${how}`)}`)

  const results = []
  for (const { id, extractor } of extractors) {
    process.stdout.write(C.dim(`  ${PROVIDER_LABEL[id]} 识别中…`))
    try {
      const r = await extractor.extract(doc)
      results.push({ id, result: r })
      process.stdout.write(
        `\r  ${C.dim(PROVIDER_LABEL[id])} ${C.green('完成')} ${C.dim(`${r.meta.fieldCount} 个字段 · ${(r.meta.elapsedMs / 1000).toFixed(1)}s · ${r.meta.model}`)}\n`,
      )
    } catch (err) {
      results.push({ id, error: err instanceof Error ? err.message : String(err) })
      process.stdout.write(`\r  ${C.dim(PROVIDER_LABEL[id])} ${C.red('失败')} ${err.message}\n`)
    }
  }

  const ok = results.filter((r) => r.result)
  if (ok.length === 0) return null

  // 表格
  const labelW = 14
  const colW = 34
  // 只有一家时没有「一致性」可言，不占这一列
  const multi = ok.length > 1
  console.log()
  console.log(
    '  ' +
      pad('字段', labelW) +
      ok.map((r) => pad(PROVIDER_LABEL[r.id], colW)).join('') +
      (multi ? '一致性' : ''),
  )
  console.log('  ' + C.dim('─'.repeat(labelW + colW * ok.length + (multi ? 8 : 0))))

  const disagreements = []
  for (const field of EXTRACTABLE_FIELDS) {
    const cells = ok.map((r) => r.result.fields[field])
    if (cells.every((c) => !c)) continue // 谁都没识别出来的字段不占版面

    const values = cells.map((c) => (c && c.value !== null ? String(c.value) : null))
    const present = values.filter((v) => v !== null)
    let verdict
    if (!multi) verdict = ''
    else if (present.length < ok.length) {
      verdict = C.yellow('仅一家识别出')
      disagreements.push({ field, values })
    } else if (new Set(present).size === 1) verdict = C.green('一致')
    else {
      verdict = C.red('不一致')
      disagreements.push({ field, values })
    }

    console.log(
      '  ' +
        pad(CONTRACT_FIELD_LABEL[field] ?? field, labelW) +
        cells.map((c) => pad(renderCell(c), colW)).join('') +
        verdict,
    )
  }

  console.log('  ' + C.dim(`${C.yellow('!')} = 低置信度   ${C.dim('~')} = 中等置信度`))

  if (disagreements.length > 0) {
    console.log(`\n  ${C.red('需要翻原件核对：')}`)
    for (const d of disagreements) {
      console.log(
        `    · ${CONTRACT_FIELD_LABEL[d.field] ?? d.field}：` +
          ok.map((r, i) => `${PROVIDER_LABEL[r.id]}=${d.values[i] ?? '未识别'}`).join('  vs  '),
      )
    }
  }

  return { path, results: ok, disagreements }
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.log('用法：npm run compare -w apps/server -- <合同文件...>')
    console.log('例如：npm run compare -w apps/server -- ./samples/*.pdf')
    process.exit(1)
  }

  const extractors = availableExtractors()
  if (extractors.length === 0) {
    console.log(C.red('没有配置任何识别服务的 API key。'))
    console.log('在 .env 里填 DEEPSEEK_API_KEY 或 DASHSCOPE_API_KEY 后再试。')
    process.exit(1)
  }

  console.log(C.bold('识别结果对比'))
  console.log(C.dim(`参与对比：${extractors.map((e) => PROVIDER_LABEL[e.id]).join('、')}`))
  console.log(C.dim('注意：文件会被上传到对应厂商的服务器'))

  const all = []
  for (const f of files) {
    try {
      const r = await runOne(f, extractors)
      if (r) all.push(r)
    } catch (err) {
      console.log(C.red(`\n${basename(f)} 处理失败：${err.message}`))
    }
  }

  if (all.length === 0 || extractors.length < 2) return

  // 汇总
  console.log(`\n${C.bold('━━━ 汇总 ━━━')}\n`)
  for (const { id } of extractors) {
    const rs = all.flatMap((a) => a.results.filter((r) => r.id === id).map((r) => r.result))
    const fields = rs.reduce((n, r) => n + r.meta.fieldCount, 0)
    const low = rs.reduce((n, r) => n + r.meta.lowConfidenceCount, 0)
    const ms = rs.reduce((n, r) => n + r.meta.elapsedMs, 0)
    console.log(
      `  ${pad(PROVIDER_LABEL[id], 22)} 共识别 ${String(fields).padStart(3)} 个字段` +
        `（低置信 ${low}）  平均 ${(ms / rs.length / 1000).toFixed(1)}s/份`,
    )
  }
  const totalDis = all.reduce((n, a) => n + a.disagreements.length, 0)
  console.log(`\n  两家共有 ${C.bold(String(totalDis))} 处不一致，建议逐条翻原件确认哪家对。`)
  console.log(C.dim('  字段数多不代表更准 —— 编造出来的字段也会计入。'))
}

main().catch((err) => {
  console.error(C.red('\n对比脚本异常：'), err)
  process.exit(1)
})
