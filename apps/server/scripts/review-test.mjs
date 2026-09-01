#!/usr/bin/env node
/**
 * 风险审查的防幻觉验证（纯本地，不调模型）。
 *
 * 守的是这条：**没有原文依据的风险点一律丢弃。**
 *
 * 光在 schema 里要求 evidence 必填是不够的 —— 模型完全可以编一句像模像样的
 * 话填进去。真正的闸门是拿它回原文里核一遍。这个脚本就在验那道核对。
 *
 *   npm run test:review -w apps/server
 */

const { normalizeForMatch, evidenceFoundIn } = await import('../src/modules/review/service.ts')

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

/** 一份贴近真实的合同正文：PDF 抽出来的文字带乱七八糟的换行和空格 */
const CONTRACT = `办公家具采购合同

甲方：某某科技有限公司
乙方：优家办公家具有限公司

第三条  合同金额
本合同总金额为人民币壹拾贰万捌仟陆佰元整（￥128,600.00），
含增值税，税率 13%。

第四条  付款方式
合同签订后预付 30%，验收合格后 15 个工作日内付清余款。

第五条  合同期限
本合同自 2026 年 3 月 15 日起生效，至 2027 年 3 月 14 日终止。

第八条  违约责任
乙方逾期交付的，每逾期一日按合同总金额的千分之三支付违约金。`

const H = normalizeForMatch(CONTRACT)

console.log('\x1b[1m风险审查 · 防幻觉验证\x1b[0m\x1b[90m（纯本地，不调模型）\x1b[0m')

/* ── A 真依据要留下 ──────────────────────────────────────────────── */
section('A · 真实存在的依据必须留下')

check('一字不差的原句', evidenceFoundIn(H, '合同签订后预付 30%，验收合格后 15 个工作日内付清余款。'))

check(
  '模型抹平了换行和空格（最常见的情况）',
  evidenceFoundIn(H, '本合同自2026年3月15日起生效，至2027年3月14日终止。'),
)

check(
  '模型把中文标点写成了英文标点',
  evidenceFoundIn(H, '合同签订后预付 30%,验收合格后 15 个工作日内付清余款.'),
)

check(
  '带全角括号的金额条款',
  evidenceFoundIn(H, '本合同总金额为人民币壹拾贰万捌仟陆佰元整（￥128,600.00）'),
)

check('跨行引用（原文里中间有个换行）', evidenceFoundIn(H, '（￥128,600.00），含增值税，税率 13%'))

/* ── B 编造的必须丢掉 ───────────────────────────────────────────── */
section('B · 编造的依据必须丢掉')

check(
  '\x1b[1m整句编造（听起来很像合同里会有的话）\x1b[0m',
  !evidenceFoundIn(H, '本合同未约定质保期及质保金退还条件。'),
  '这正是模型最爱编的那种句子',
)

check(
  '\x1b[1m改了关键数字（30% 篡改成 80%）\x1b[0m',
  !evidenceFoundIn(H, '合同签订后预付 80%，验收合格后 15 个工作日内付清余款。'),
  '数字错了就不该算数——这种最危险，用户一眼看不出来',
)

check('把日期改掉了', !evidenceFoundIn(H, '本合同自 2026 年 5 月 15 日起生效'))

check(
  '换了措辞的「转述」不算原文',
  !evidenceFoundIn(H, '合同约定签订后先付三成，验收后付清'),
  '意思对，但不是原句',
)

check('凭空多加了一个条款号', !evidenceFoundIn(H, '第十二条  争议解决'))

/* ── C 边界 ─────────────────────────────────────────────────────── */
section('C · 边界')

check(
  '太短的片段不算依据（「合同」谁都能命中）',
  !evidenceFoundIn(H, '合同'),
  '否则等于没验',
)

check('空字符串不算依据', !evidenceFoundIn(H, ''))
check('纯空白不算依据', !evidenceFoundIn(H, '     '))

// 被涂抹的地方在正文里是 〔已涂抹〕，跨过它的引用自然对不上 —— 这是对的：
// 模型没看到那段内容，就不该拿它当依据。
const REDACTED = normalizeForMatch(
  '第三条  合同金额\n本合同总金额为人民币〔已涂抹〕，含增值税，税率 13%。',
)
check(
  '\x1b[1m涂抹掉的内容不能被当成依据\x1b[0m',
  !evidenceFoundIn(REDACTED, '本合同总金额为人民币壹拾贰万捌仟陆佰元整'),
  '模型压根没看到这段，编出来的一定是假的',
)
check('但同一句里没被涂的部分照样能当依据', evidenceFoundIn(REDACTED, '含增值税，税率 13%'))

/* ── 汇总 ───────────────────────────────────────────────────────── */
console.log(`\n${'─'.repeat(60)}`)
if (failed === 0) {
  console.log(`\x1b[32m\x1b[1m全部通过\x1b[0m  ${passed} 项`)
} else {
  console.log(`\x1b[31m\x1b[1m${failed} 项失败\x1b[0m，${passed} 项通过\n`)
  for (const f of failures) console.log(`  \x1b[31m·\x1b[0m ${f}`)
}
process.exit(failed === 0 ? 0 : 1)
