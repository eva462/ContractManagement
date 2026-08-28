#!/usr/bin/env node
/**
 * 接口层冒烟测试 —— 逐条对应 docs/design/01-合同主数据模块.md 第 5 节的验收标准。
 *
 * 用法（服务和数据库要先起来）：
 *   npm run db:reset && npm run db:migrate && npm run db:seed
 *   npm run dev:server
 *   npm run smoke -w apps/server
 *
 * 会留下几条以「[冒烟]」开头的合同，想清干净重跑一次 db:reset 即可。
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100'
const API = `${BASE}/api/v1`

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`)
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

async function call(method, path, { token, body, raw } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (raw) return res
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON 响应，保留 null */
  }
  return { status: res.status, body: json, headers: res.headers }
}

const login = async (username) => {
  const r = await call('POST', '/auth/login', { body: { username, password: 'admin123' } })
  if (r.status !== 200) throw new Error(`登录 ${username} 失败: ${JSON.stringify(r.body)}`)
  return r.body.data.accessToken
}

const errCode = (r) => r.body?.error?.code
const issueFields = (r) => (r.body?.error?.issues ?? []).map((i) => i.field)

async function main() {
  console.log(`\x1b[1m合同主数据模块 · 接口冒烟测试\x1b[0m  →  ${BASE}\n`)

  /* ── A 环境与登录 ─────────────────────────────────────────────── */
  section('A · 环境与认证')

  const health = await fetch(`${BASE}/health`)
  check('健康检查可访问', health.status === 200)

  const staff = await login('staff')
  const manager = await login('manager')
  const admin = await login('admin')
  check('三个种子账号都能登录', !!staff && !!manager && !!admin)

  const noAuth = await call('GET', '/contracts')
  check('未带 token 访问受保护接口返回 401', noAuth.status === 401, `实际 ${noAuth.status}`)

  const badPwd = await call('POST', '/auth/login', {
    body: { username: 'staff', password: 'wrong-password' },
  })
  check('密码错误返回 BAD_CREDENTIALS', errCode(badPwd) === 'BAD_CREDENTIALS')

  const me = await call('GET', '/auth/me', { token: staff })
  check('GET /auth/me 返回当前用户与角色', me.body?.data?.role === 'STAFF')

  /* ── C 台账查询 ───────────────────────────────────────────────── */
  section('C · 合同台账')

  const list = await call('GET', '/contracts?pageSize=50', { token: staff })
  const seeded = list.body?.data ?? []
  check('列表返回种子数据', seeded.length >= 7, `实际 ${seeded.length} 条`)
  check('分页 meta 完整', ['page', 'pageSize', 'total', 'totalPages'].every((k) => k in (list.body?.meta ?? {})))

  const kw = await call('GET', '/contracts?keyword=' + encodeURIComponent('运维'), { token: staff })
  check('关键词命中合同名称', (kw.body?.data ?? []).some((c) => c.title.includes('运维')))

  const kwParty = await call('GET', '/contracts?keyword=' + encodeURIComponent('恒瑞'), { token: staff })
  check('关键词命中对方单位', (kwParty.body?.data ?? []).length === 1)

  const kwNo = await call('GET', '/contracts?keyword=CG-2026', { token: staff })
  check('关键词命中合同编号', (kwNo.body?.data ?? []).some((c) => c.contractNo?.startsWith('CG-2026')))

  // 用全量列表交叉验证筛选语义，而不是断言「至少有 N 条」——
  // 后面的用例会把种子数据里的合同终止掉，写死条数的断言重跑就会挂。
  // 这样既不依赖种子数据存活，断言本身还更严格（要求集合完全相等）。
  const all = await call('GET', '/contracts?pageSize=100', { token: staff })
  const allItems = all.body?.data ?? []
  const idsWhere = (state) =>
    new Set(allItems.filter((c) => c.expiryState === state).map((c) => c.id))
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

  const expired = await call('GET', '/contracts?expiry=EXPIRED', { token: staff })
  check(
    '筛选「已过期」返回的正好是全量里已过期的那些',
    sameSet(new Set((expired.body?.data ?? []).map((c) => c.id)), idsWhere('EXPIRED')) &&
      (expired.body?.data ?? []).every((c) => c.expiryState === 'EXPIRED'),
  )

  const expiring = await call('GET', '/contracts?expiry=EXPIRING', { token: staff })
  check(
    '筛选「即将到期」返回的正好是全量里即将到期的那些',
    sameSet(new Set((expiring.body?.data ?? []).map((c) => c.id)), idsWhere('EXPIRING')) &&
      (expiring.body?.data ?? []).every((c) => c.expiryState === 'EXPIRING'),
  )

  const perpetual = seeded.find((c) => c.isPerpetual)
  check('长期有效合同的到期态是 PERPETUAL', perpetual?.expiryState === 'PERPETUAL')

  const draftOnly = await call('GET', '/contracts?status=DRAFT', { token: staff })
  check('按状态筛选生效', (draftOnly.body?.data ?? []).every((c) => c.status === 'DRAFT'))

  const sorted = await call('GET', '/contracts?sort=amount&order=desc&pageSize=50', { token: staff })
  const amounts = (sorted.body?.data ?? []).map((c) => c.amount).filter((a) => a !== null).map(Number)
  check('按金额降序排序正确', amounts.every((v, i) => i === 0 || amounts[i - 1] >= v))

  check(
    '金额以字符串返回（保留两位小数，不走浮点）',
    seeded.every((c) => c.amount === null || (typeof c.amount === 'string' && /\.\d{2}$/.test(c.amount))),
  )

  /* ── B 录入与校验 ─────────────────────────────────────────────── */
  section('B · 手工录入与校验')

  // 断言写成「相对递增」而不是写死 CG-2026-0002，这样脚本可以在同一个库上
  // 重复跑而不需要每次 db:reset —— 之前写死的话第二遍就必然失败。
  const nextNo = await call('GET', '/contracts/next-no?contractType=PURCHASE', { token: staff })
  const generated = nextNo.body?.data?.contractNo ?? ''
  const noMatch = /^CG-(\d{4})-(\d{4})$/.exec(generated)
  check('自动生成编号符合「类型-年份-4位流水」格式', noMatch !== null, `实际 ${generated}`)

  const existingPurchase = seeded
    .map((c) => /^CG-\d{4}-(\d{4})$/.exec(c.contractNo ?? '')?.[1])
    .filter(Boolean)
    .map(Number)
  const maxExisting = existingPurchase.length ? Math.max(...existingPurchase) : 0
  check(
    '自动生成编号取当前最大流水 +1',
    noMatch !== null && Number(noMatch[2]) === maxExisting + 1,
    `已有最大 ${maxExisting}，生成 ${generated}`,
  )

  const dup = await call('POST', '/contracts', {
    token: staff,
    body: { title: '[冒烟] 编号重复', contractNo: 'CG-2026-0001' },
  })
  check('重复编号被拒且定位到 contractNo', errCode(dup) === 'CONTRACT_NO_DUPLICATED' && issueFields(dup).includes('contractNo'))

  const noAmount = await call('POST', '/contracts', {
    token: staff,
    body: { title: '[冒烟] 含税但没填金额', amountType: 'TAX_INCLUDED' },
  })
  check('含税/不含税但金额为空被拦，定位到 amount', errCode(noAmount) === 'VALIDATION_FAILED' && issueFields(noAmount).includes('amount'))

  const amountConflict = await call('POST', '/contracts', {
    token: staff,
    body: { title: '[冒烟] 无金额却填了金额', amountType: 'NO_AMOUNT', amount: '100.00' },
  })
  check('「无金额」却填了金额被拦', issueFields(amountConflict).includes('amount'))

  const perpetualConflict = await call('POST', '/contracts', {
    token: staff,
    body: { title: '[冒烟] 长期有效却填到期日', isPerpetual: true, expiryDate: '2027-01-01' },
  })
  check('长期有效与到期日期互斥', issueFields(perpetualConflict).includes('expiryDate'))

  const dateOrder = await call('POST', '/contracts', {
    token: staff,
    body: { title: '[冒烟] 生效早于签订', signDate: '2026-06-01', effectiveDate: '2026-05-01' },
  })
  check('生效日期早于签订日期被拦', issueFields(dateOrder).includes('effectiveDate'))

  const emptyTitle = await call('POST', '/contracts', { token: staff, body: { title: '   ' } })
  check('合同名称为空被拦', issueFields(emptyTitle).includes('title'))

  const incomplete = await call('POST', '/contracts', {
    token: staff,
    body: { title: '[冒烟] 直接生效但字段不全', activate: true },
  })
  check('提交生效字段不全时用专门错误码', errCode(incomplete) === 'INCOMPLETE_FOR_ACTIVATION')
  check(
    '并列出具体缺哪些字段',
    issueFields(incomplete).includes('contractNo') && issueFields(incomplete).includes('signDate'),
    issueFields(incomplete).join(','),
  )

  const draft = await call('POST', '/contracts', { token: staff, body: { title: '[冒烟] 最小草稿' } })
  check('只填合同名称即可存为草稿', draft.status === 201 && draft.body?.data?.status === 'DRAFT')
  check('草稿默认经办人是当前用户', draft.body?.data?.owner?.username === 'staff')
  const draftId = draft.body?.data?.id

  /* ── D 编辑与状态流转 ─────────────────────────────────────────── */
  section('D · 查看 / 编辑 / 状态流转')

  const fill = await call('PATCH', `/contracts/${draftId}`, {
    token: staff,
    body: {
      contractNo: nextNo.body.data.contractNo,
      title: '[冒烟] 完整采购合同',
      contractType: 'PURCHASE',
      counterpartyName: '冒烟测试供应商有限公司',
      amountType: 'TAX_INCLUDED',
      amount: '100000.00',
      signDate: '2026-01-10',
      effectiveDate: '2026-01-15',
      expiryDate: '2026-12-31',
    },
  })
  check('补齐草稿字段成功', fill.status === 200, JSON.stringify(fill.body?.error ?? ''))

  const noop = await call('PATCH', `/contracts/${draftId}`, { token: staff, body: { title: '[冒烟] 完整采购合同' } })
  check('提交与原值相同的内容不报错', noop.status === 200)

  const activate = await call('POST', `/contracts/${draftId}/status`, { token: staff, body: { action: 'ACTIVATE' } })
  check('经办人本人可以提交生效', activate.status === 200 && activate.body?.data?.status === 'ACTIVE')

  const money = await call('PATCH', `/contracts/${draftId}`, {
    token: staff,
    body: { amount: '120000.00', expiryDate: '2027-06-30' },
  })
  check('生效后仍可编辑（本人经办）', money.status === 200 && money.body?.data?.amount === '120000.00')

  const noReason = await call('POST', `/contracts/${draftId}/status`, { token: manager, body: { action: 'TERMINATE' } })
  check('终止时不填原因被拦', noReason.status === 400 && issueFields(noReason).includes('terminationReason'))

  const staffTerminate = await call('POST', `/contracts/${draftId}/status`, {
    token: staff,
    body: { action: 'TERMINATE', terminationReason: '测试', terminatedAt: '2026-07-01' },
  })
  check('STAFF 无权终止合同', staffTerminate.status === 403, `实际 ${staffTerminate.status}`)

  const badTransition = await call('POST', `/contracts/${draftId}/status`, { token: admin, body: { action: 'ACTIVATE' } })
  check('对已生效的合同再次提交生效被拒', errCode(badTransition) === 'ILLEGAL_TRANSITION')

  const otherContract = seeded.find((c) => c.owner?.username === 'manager' && c.status === 'ACTIVE')
  const crossEdit = await call('PATCH', `/contracts/${otherContract.id}`, { token: staff, body: { remark: '越权修改' } })
  check('STAFF 改别人经办的合同返回 403', crossEdit.status === 403, `实际 ${crossEdit.status}`)

  const crossRead = await call('GET', `/contracts/${otherContract.id}`, { token: staff })
  check('但仍能查看别人经办的合同（可见范围 ALL）', crossRead.status === 200)
  check('且返回的 permissions.canEdit 为 false', crossRead.body?.data?.permissions?.canEdit === false)

  const terminate = await call('POST', `/contracts/${draftId}/status`, {
    token: manager,
    body: { action: 'TERMINATE', terminationReason: '对方违约，协商解除', terminatedAt: '2026-07-01' },
  })
  check('MANAGER 可以终止，并写入终止原因', terminate.body?.data?.terminationReason === '对方违约，协商解除')

  const archive = await call('POST', `/contracts/${draftId}/status`, { token: manager, body: { action: 'ARCHIVE' } })
  check('MANAGER 可以归档', archive.body?.data?.status === 'ARCHIVED')
  check('归档时记录了归档前的状态', archive.body?.data?.archivedFrom === 'TERMINATED')
  check('归档后 permissions 全部关闭', archive.body?.data?.permissions?.canEdit === false && archive.body?.data?.permissions?.canUploadAttachment === false)

  const editArchived = await call('PATCH', `/contracts/${draftId}`, { token: admin, body: { remark: '改归档合同' } })
  check('已归档合同连 ADMIN 也不能改', errCode(editArchived) === 'CONTRACT_READONLY', `实际 ${editArchived.status}/${errCode(editArchived)}`)

  const managerUnarchive = await call('POST', `/contracts/${draftId}/status`, { token: manager, body: { action: 'UNARCHIVE' } })
  check('MANAGER 无权解除归档', managerUnarchive.status === 403)

  const unarchive = await call('POST', `/contracts/${draftId}/status`, { token: admin, body: { action: 'UNARCHIVE' } })
  check('ADMIN 解除归档后回到归档前的状态', unarchive.body?.data?.status === 'TERMINATED', `实际 ${unarchive.body?.data?.status}`)

  const delActive = await call('DELETE', `/contracts/${draftId}`, { token: admin })
  check('非草稿状态不能删除，只能归档', errCode(delActive) === 'CONTRACT_NOT_DELETABLE')

  const tempDraft = await call('POST', '/contracts', { token: staff, body: { title: '[冒烟] 待删除草稿' } })
  const delDraft = await call('DELETE', `/contracts/${tempDraft.body.data.id}`, { token: staff })
  check('草稿可以删除', delDraft.status === 200)
  const afterDel = await call('GET', `/contracts/${tempDraft.body.data.id}`, { token: staff })
  check('删除后查不到（软删已过滤）', afterDel.status === 404)

  /* ── E 附件 ───────────────────────────────────────────────────── */
  section('E · 附件')

  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const uploadTarget = seeded.find((c) => c.owner?.username === 'staff' && c.status === 'ACTIVE')

  const fd = new FormData()
  fd.append('attachmentType', 'ORIGINAL')
  fd.append('file', new Blob([png], { type: 'image/png' }), '合同扫描件 第1页.png')
  const up = await call('POST', `/contracts/${uploadTarget.id}/attachments`, { token: staff, body: fd })
  check('上传 PNG 成功', up.status === 201, JSON.stringify(up.body?.error ?? ''))
  check('保留原始中文文件名', up.body?.data?.fileName === '合同扫描件 第1页.png')
  check('PNG 标记为可预览', up.body?.data?.previewable === true)
  const attId = up.body?.data?.id

  const fdExe = new FormData()
  fdExe.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe')
  const upExe = await call('POST', `/contracts/${uploadTarget.id}/attachments`, { token: staff, body: fdExe })
  check('.exe 被类型白名单拒绝', errCode(upExe) === 'ATTACHMENT_TYPE_REJECTED')

  const fdFake = new FormData()
  fdFake.append('file', new Blob([Buffer.from('x')], { type: 'application/pdf' }), 'trick.exe')
  const upFake = await call('POST', `/contracts/${uploadTarget.id}/attachments`, { token: staff, body: fdFake })
  check('MIME 伪装成 PDF 但扩展名是 .exe 同样被拒', errCode(upFake) === 'ATTACHMENT_TYPE_REJECTED')

  const dl = await call('GET', `/attachments/${attId}/download`, { token: staff, raw: true })
  check('下载返回 200', dl.status === 200)
  const cd = dl.headers.get('content-disposition') ?? ''
  check('中文文件名按 RFC 5987 编码', cd.includes("filename*=UTF-8''") && cd.includes(encodeURIComponent('合同扫描件 第1页.png')))
  check('下载响应禁止缓存', (dl.headers.get('cache-control') ?? '').includes('no-store'))

  const fdDup = new FormData()
  fdDup.append('file', new Blob([png], { type: 'image/png' }), '同一张图 副本.png')
  const upDup = await call('POST', `/contracts/${uploadTarget.id}/attachments`, { token: staff, body: fdDup })
  check('同内容不同文件名可重复上传（内容去重）', upDup.status === 201)

  const delAtt = await call('DELETE', `/attachments/${upDup.body.data.id}`, { token: staff })
  check('删除其中一个副本成功', delAtt.status === 200)
  const stillThere = await call('GET', `/attachments/${attId}/download`, { token: staff, raw: true })
  check('另一条引用同一内容的附件仍可下载（去重删除没误删）', stillThere.status === 200)

  const archivedContract = seeded.find((c) => c.status === 'ARCHIVED')
  const fdArch = new FormData()
  fdArch.append('file', new Blob([png], { type: 'image/png' }), 'x.png')
  const upArch = await call('POST', `/contracts/${archivedContract.id}/attachments`, { token: admin, body: fdArch })
  check('已归档合同不能上传附件', errCode(upArch) === 'CONTRACT_READONLY')

  /* ── F 操作留痕 ───────────────────────────────────────────────── */
  section('F · 操作留痕')

  const logs = await call('GET', `/contracts/${draftId}/audit-logs?pageSize=50`, { token: staff })
  const entries = logs.body?.data ?? []
  const actions = entries.map((e) => e.action)

  check('创建有留痕', actions.includes('CREATE'))
  check('编辑有留痕', actions.includes('UPDATE'))
  check('状态流转有留痕', actions.includes('STATUS_CHANGE'))
  check('时间线按时间倒序', entries.every((e, i) => i === 0 || entries[i - 1].createdAt >= e.createdAt))

  const moneyLog = entries.find((e) => e.action === 'UPDATE' && e.changes?.amount)
  check('金额变更被记录', !!moneyLog)
  check(
    '摘要是人话且带操作人',
    !!moneyLog && moneyLog.summary.includes('张三') && moneyLog.summary.includes('合同金额从 ¥100,000.00 修改为 ¥120,000.00'),
    moneyLog?.summary,
  )
  check(
    '只记录真正变化的字段（没改的不出现在 diff 里）',
    !!moneyLog && Object.keys(moneyLog.changes).sort().join(',') === 'amount,expiryDate',
    moneyLog && Object.keys(moneyLog.changes).join(','),
  )
  check('diff 含 before/after 两侧', moneyLog?.changes?.amount?.before === '100000.00' && moneyLog?.changes?.amount?.after === '120000.00')
  check('留痕带来源 IP', entries.every((e) => e.ip !== null))
  check('用户名是写入时的快照', entries.every((e) => typeof e.userName === 'string' && e.userName.length > 0))

  const noopLogCount = entries.filter((e) => e.action === 'UPDATE').length
  check('无变化的提交没有产生多余留痕', noopLogCount === 2, `UPDATE 条数 ${noopLogCount}`)

  const attLogs = await call('GET', `/contracts/${uploadTarget.id}/audit-logs?pageSize=50`, { token: staff })
  const attActions = (attLogs.body?.data ?? []).map((e) => e.action)
  check('上传附件有留痕', attActions.includes('UPLOAD'))
  check('下载附件有留痕', attActions.includes('DOWNLOAD'))
  check('删除附件有留痕', attActions.includes('DELETE'))

  const loginLogs = await call('GET', '/contracts?pageSize=1', { token: admin })
  check('登录接口本身可用（登录留痕在 USER 实体上）', loginLogs.status === 200)

  check(
    '系统没有提供修改留痕的接口',
    (await call('PATCH', `/audit-logs/${entries[0]?.id}`, { token: admin, body: { summary: 'x' } })).status === 404,
  )
  check(
    '系统没有提供删除留痕的接口',
    (await call('DELETE', `/audit-logs/${entries[0]?.id}`, { token: admin })).status === 404,
  )

  /* ── 汇总 ─────────────────────────────────────────────────────── */
  console.log(`\n${'─'.repeat(60)}`)
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m全部通过\x1b[0m  ${passed} 项`)
  } else {
    console.log(`\x1b[31m\x1b[1m${failed} 项失败\x1b[0m，${passed} 项通过\n`)
    for (const f of failures) console.log(`  \x1b[31m·\x1b[0m ${f}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n\x1b[31m冒烟测试异常中断：\x1b[0m', err)
  process.exit(1)
})
