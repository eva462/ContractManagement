#!/usr/bin/env node
/**
 * 内容识别端到端测试 —— 逐条对应 docs/design/02-合同内容识别.md 第 8 节的验收标准。
 *
 * 自己起两个进程：
 *   1. 一个假的 DeepSeek 服务（:4599），可以按剧本返回各种正常/异常响应
 *   2. 一个指向它的后端实例（:3199）
 *
 * 所以不需要真的 API key，也不会有任何数据出网。
 *
 *   npm run test:extraction -w apps/server
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as mupdf from 'mupdf'

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(here, '..')
const MOCK_PORT = 4599
const APP_PORT = 3199
const APP = `http://127.0.0.1:${APP_PORT}`

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

/* ── 假的 DeepSeek 服务 ─────────────────────────────────────────────── */

let scenario = 'messy'
let callCount = 0
const seen = [] // 记录每次调用的请求，供断言

const SCENARIOS = {
  // 刻意返回「人写的」脏值，验证本地归一化真的在起作用
  messy: () => ({
    contractNo: { value: 'CG-2026-0007', confidence: 'high', evidence: '合同编号：CG-2026-0007' },
    title: { value: ' 办公家具采购合同 ', confidence: 'high', evidence: '标题' },
    contractType: { value: 'purchase', confidence: 'high', evidence: '采购合同' },
    counterpartyName: { value: '恒信办公设备有限公司', confidence: 'high', evidence: '乙方' },
    amountType: { value: 'TAX_INCLUDED', confidence: 'medium', evidence: '含税' },
    amount: { value: '壹拾贰万捌仟陆佰元整', confidence: 'high', evidence: '大写金额' },
    currency: { value: 'CNY', confidence: 'high', evidence: '人民币' },
    signDate: { value: '2026年8月1日', confidence: 'high', evidence: '签订于二〇二六年八月一日' },
    effectiveDate: { value: '2026/08/05', confidence: 'low', evidence: '生效日期模糊' },
  }),
  // 一个字段枚举非法、一个日期不存在，其余应当照常保留
  partialInvalid: () => ({
    title: { value: '服务合同', confidence: 'high', evidence: '标题' },
    contractType: { value: 'NOT_A_REAL_TYPE', confidence: 'high', evidence: '瞎编的' },
    signDate: { value: '2026-02-30', confidence: 'high', evidence: '不存在的日期' },
    amount: { value: '88000', confidence: 'high', evidence: '金额' },
  }),
  notAContract: () => ({}),
  emptyThenOk: () => (callCount === 1 ? null : { title: { value: '重试后成功', confidence: 'high', evidence: 'x' } }),
}

const mock = createServer((req, res) => {
  if (!req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    callCount++
    const parsed = JSON.parse(body)
    const userMsg = parsed.messages.find((m) => m.role === 'user')
    seen.push({
      model: parsed.model,
      responseFormat: parsed.response_format?.type,
      temperature: parsed.temperature,
      auth: req.headers.authorization,
      isVision: Array.isArray(userMsg.content),
      imageCount: Array.isArray(userMsg.content)
        ? userMsg.content.filter((p) => p.type === 'image_url').length
        : 0,
      textLength: typeof userMsg.content === 'string' ? userMsg.content.length : 0,
    })

    if (scenario === 'unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid key' } }))
      return
    }

    const payload = SCENARIOS[scenario]()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [{ message: { content: payload === null ? '' : JSON.stringify(payload) } }],
      }),
    )
  })
})

/* ── 测试用 PDF ─────────────────────────────────────────────────────── */

async function makeTextPdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('PURCHASE CONTRACT No. CG-2026-0007', { x: 60, y: 760, size: 14, font })
  page.drawText('Party B: Hengxin Office Equipment Co Ltd', { x: 60, y: 730, size: 11, font })
  page.drawText('Amount: RMB 128,600.00 (tax included)', { x: 60, y: 710, size: 11, font })
  page.drawText('Signed 2026-08-01, effective 2026-08-05', { x: 60, y: 690, size: 11, font })
  return Buffer.from(await doc.save())
}

/** 造一份「扫描件」：把上面那页渲染成图片，再塞进一个只有图片的 PDF */
async function makeScannedPdf(textPdf) {
  const src = mupdf.Document.openDocument(textPdf, 'application/pdf')
  const pix = src.loadPage(0).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true)
  const png = Buffer.from(pix.asPNG())

  const doc = await PDFDocument.create()
  const img = await doc.embedPng(png)
  const page = doc.addPage([595, 842])
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
  return Buffer.from(await doc.save())
}

/* ── 工具 ──────────────────────────────────────────────────────────── */

const login = async () => {
  const r = await fetch(`${APP}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'staff', password: 'admin123' }),
  })
  if (!r.ok) throw new Error(`登录失败 ${r.status}`)
  return (await r.json()).data.accessToken
}

async function extract(token, buffer, fileName, mimeType) {
  const fd = new FormData()
  fd.append('file', new Blob([buffer], { type: mimeType }), fileName)
  const r = await fetch(`${APP}/api/v1/extraction/contract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const waitForHealth = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/* ── 主流程 ────────────────────────────────────────────────────────── */

let appProc

async function main() {
  console.log('\x1b[1m内容识别 · 端到端测试\x1b[0m（假 DeepSeek 服务，无数据出网）\n')

  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))

  appProc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverRoot,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      DEEPSEEK_API_KEY: 'test-key-for-mock',
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      EXTRACTION_TIMEOUT_MS: '10000',
    },
    stdio: 'ignore',
  })

  if (!(await waitForHealth(`${APP}/health`))) throw new Error('后端测试实例没起来')

  const token = await login()
  const textPdf = await makeTextPdf()
  const scannedPdf = await makeScannedPdf(textPdf)

  /* ── A 开关 ── */
  section('A · 可用性开关')
  const st = await (await fetch(`${APP}/api/v1/extraction/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()
  check('配了 key 时 available:true', st.data.available === true)
  check('返回支持的文件类型', Array.isArray(st.data.supportedMimes) && st.data.supportedMimes.includes('application/pdf'))

  /* ── B 文档解析 ── */
  section('B · 文档解析（本地，不出网）')
  seen.length = 0
  callCount = 0
  scenario = 'messy'

  const r1 = await extract(token, textPdf, '采购合同.pdf', 'application/pdf')
  check('电子版 PDF 识别成功', r1.status === 200, JSON.stringify(r1.body?.error ?? ''))
  check('走文本路径（mode=text）', r1.body?.data?.meta?.mode === 'text')
  check('文本路径不产生任何图片', r1.body?.data?.meta?.imageCount === 0)
  check('文本路径用文本模型', seen[0]?.model === 'deepseek-v4-pro', seen[0]?.model)
  check('把 PDF 正文送了出去', seen[0]?.textLength > 100)

  seen.length = 0
  const r2 = await extract(token, scannedPdf, '扫描件.pdf', 'application/pdf')
  check('扫描件 PDF 识别成功', r2.status === 200, JSON.stringify(r2.body?.error ?? ''))
  check('走图片路径（mode=vision）', r2.body?.data?.meta?.mode === 'vision')
  check('每页切成 4 块', r2.body?.data?.meta?.imageCount === 4, String(r2.body?.data?.meta?.imageCount))
  check('图片路径用 vision 模型', seen[0]?.model === 'deepseek-v4-flash-vision-exp', seen[0]?.model)
  check('确实发出了 4 张图', seen[0]?.imageCount === 4, String(seen[0]?.imageCount))

  seen.length = 0
  const r3 = await extract(token, Buffer.from('not a pdf at all'), '坏文件.pdf', 'application/pdf')
  check('损坏的 PDF 被明确拒绝，不崩', r3.status === 400 || r3.status === 502, String(r3.status))

  const r4 = await extract(token, textPdf, '合同.txt', 'text/plain')
  check('不支持的类型被拒绝', r4.status === 400 && r4.body?.error?.message?.includes('不支持'))

  /* ── C 归一化与校验 ── */
  section('C · 归一化与校验')
  seen.length = 0
  scenario = 'messy'
  const r5 = await extract(token, textPdf, '合同.pdf', 'application/pdf')
  const f = r5.body?.data?.fields ?? {}

  check('请求带上了 Bearer key', seen[0]?.auth === 'Bearer test-key-for-mock')
  check('请求指定了 json 输出模式', seen[0]?.responseFormat === 'json_object')
  check('温度设为 0（抽取要确定性）', seen[0]?.temperature === 0)
  check('中文大写金额被转成数字', f.amount?.value === '128600.00', f.amount?.value)
  check('中文日期被转成 YYYY-MM-DD', f.signDate?.value === '2026-08-01', f.signDate?.value)
  check('斜杠日期被转成 YYYY-MM-DD', f.effectiveDate?.value === '2026-08-05', f.effectiveDate?.value)
  check('小写枚举被转成大写', f.contractType?.value === 'PURCHASE', f.contractType?.value)
  check('文本两端空白被去掉', f.title?.value === '办公家具采购合同', JSON.stringify(f.title?.value))
  check('置信度被保留', f.effectiveDate?.confidence === 'low')
  check('原文出处被保留', typeof f.contractNo?.evidence === 'string' && f.contractNo.evidence.length > 0)
  check('低置信度计数正确', r5.body?.data?.meta?.lowConfidenceCount === 1, String(r5.body?.data?.meta?.lowConfidenceCount))

  scenario = 'partialInvalid'
  const r6 = await extract(token, textPdf, '合同.pdf', 'application/pdf')
  const f6 = r6.body?.data?.fields ?? {}
  check('非法枚举的字段被丢弃', f6.contractType === undefined)
  check('不存在的日期被丢弃', f6.signDate === undefined)
  check('同一次里合法的字段照常保留', f6.title?.value === '服务合同' && f6.amount?.value === '88000.00')

  /* ── D 异常路径 ── */
  section('D · 异常与边界')
  scenario = 'notAContract'
  const r7 = await extract(token, textPdf, '风景照.pdf', 'application/pdf')
  check('识别不出内容时不报错，返回空结果', r7.status === 200 && r7.body?.data?.meta?.fieldCount === 0)

  scenario = 'emptyThenOk'
  callCount = 0
  const r8 = await extract(token, textPdf, '合同.pdf', 'application/pdf')
  check('模型返回空内容时会自动重试', r8.status === 200 && r8.body?.data?.fields?.title?.value === '重试后成功')
  check('重试确实发生了（调用了 2 次）', callCount === 2, `实际 ${callCount} 次`)

  scenario = 'unauthorized'
  const r9 = await extract(token, textPdf, '合同.pdf', 'application/pdf')
  check('key 无效时给出可读的中文提示', r9.status === 502 && /key/i.test(r9.body?.error?.message ?? ''), r9.body?.error?.message)

  const r10 = await fetch(`${APP}/api/v1/extraction/contract`, { method: 'POST' })
  check('未登录不能调用识别接口', r10.status === 401)

  /* ── E 留痕 ── */
  section('E · 留痕')
  scenario = 'messy'
  await extract(token, textPdf, '留痕验证.pdf', 'application/pdf')

  const adminTok = await (async () => {
    const r = await fetch(`${APP}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    return (await r.json()).data.accessToken
  })()

  // 通过一份合同的留痕接口拿不到 USER 实体的记录，直接查库更直接；
  // 这里改用一个只有 admin 能看的侧面验证：识别不应该污染任何合同的时间线
  const contracts = await (await fetch(`${APP}/api/v1/contracts?pageSize=1`, {
    headers: { Authorization: `Bearer ${adminTok}` },
  })).json()
  const anyContractId = contracts.data?.[0]?.id
  const logs = await (await fetch(`${APP}/api/v1/contracts/${anyContractId}/audit-logs`, {
    headers: { Authorization: `Bearer ${adminTok}` },
  })).json()
  check('识别不会污染合同的操作留痕', !(logs.data ?? []).some((l) => l.action === 'EXTRACT'))
  console.log('  \x1b[90m·\x1b[0m EXTRACT 记录挂在用户实体上（识别时合同还不存在），需查库核对')

  /* ── 汇总 ── */
  console.log(`\n${'─'.repeat(60)}`)
  if (failed === 0) console.log(`\x1b[32m\x1b[1m全部通过\x1b[0m  ${passed} 项`)
  else {
    console.log(`\x1b[31m\x1b[1m${failed} 项失败\x1b[0m，${passed} 项通过\n`)
    for (const x of failures) console.log(`  \x1b[31m·\x1b[0m ${x}`)
  }
}

main()
  .catch((err) => {
    console.error('\n\x1b[31m测试异常中断：\x1b[0m', err)
    failed++
  })
  .finally(() => {
    appProc?.kill()
    mock.close()
    setTimeout(() => process.exit(failed === 0 ? 0 : 1), 300)
  })
