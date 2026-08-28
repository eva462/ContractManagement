#!/usr/bin/env node
/**
 * 量一下本地 PDF 解析到底花多久 —— 用来判断「拆页并行」值不值得做。
 * 纯本地，不调任何接口、不花钱。
 *
 *   npm run bench:parse -w apps/server
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
process.chdir(resolve(here, '..'))
const root = resolve(here, '../../..')

const { loadDocument } = await import('../src/extraction/document-loader.ts')
const { PDFDocument } = await import('pdf-lib')

const dim = (s) => `\x1b[90m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`

/** 把单页 PDF 复制成 n 页，模拟多页合同 */
async function repeat(srcPath, n) {
  const src = await PDFDocument.load(readFileSync(srcPath))
  const out = await PDFDocument.create()
  for (let i = 0; i < n; i++) {
    const [p] = await out.copyPages(src, [0])
    out.addPage(p)
  }
  return Buffer.from(await out.save())
}

const bench = (buffer, name) => {
  let best = Infinity
  let doc
  // 跑 3 次取最好，排除首次 WASM 初始化的干扰
  for (let i = 0; i < 3; i++) {
    const t = performance.now()
    doc = loadDocument({ buffer, mimeType: 'application/pdf', fileName: name })
    best = Math.min(best, performance.now() - t)
  }
  return { ms: best, doc }
}

const samples = {
  text: resolve(root, 'var/sample/电子版合同.pdf'),
  scan: resolve(root, 'var/sample/扫描件合同.pdf'),
}
for (const p of Object.values(samples)) {
  if (!existsSync(p)) {
    console.error('样本不存在，先跑 npm run sample -w apps/server')
    process.exit(1)
  }
}

console.log(bold('\n本地 PDF 解析耗时') + dim('（纯本地，不调接口）\n'))
console.log(
  '  ' + '文件'.padEnd(26) + '页数'.padEnd(8) + '路径'.padEnd(12) + '耗时'.padEnd(12) + '产出',
)
console.log('  ' + dim('─'.repeat(82)))

for (const pages of [1, 5, 10, 20]) {
  for (const [kind, path] of Object.entries(samples)) {
    const buf = pages === 1 ? readFileSync(path) : await repeat(path, pages)
    const { ms, doc } = bench(buf, `${kind}-${pages}p.pdf`)
    const out =
      doc.mode === 'text'
        ? `${doc.text.length} 字`
        : `${doc.images.length} 张图 / ${(doc.images.reduce((s, i) => s + i.data.length, 0) / 1024 / 1024).toFixed(1)} MB`
    console.log(
      '  ' +
        (kind === 'text' ? '电子版（有文本层）' : '扫描件（纯图片）').padEnd(20) +
        String(pages).padEnd(10) +
        (doc.mode === 'text' ? '文本' : '图片').padEnd(10) +
        `${ms.toFixed(0)} ms`.padEnd(12) +
        dim(out),
    )
  }
}

console.log()
console.log(dim('  对照：一次模型调用约 10–40 秒。'))
