import { normalizeAmount, normalizeDate } from '../src/extraction/normalize.js'

let pass = 0, fail = 0
const t = (fn, input, expected) => {
  const got = fn(input)
  const ok = got === expected
  ok ? pass++ : fail++
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${String(input).padEnd(28)} → ${String(got).padEnd(14)} ${ok ? '' : `\x1b[31m期望 ${expected}\x1b[0m`}`)
}

console.log('\n\x1b[1m金额归一化\x1b[0m')
t(normalizeAmount, '128600', '128600.00')
t(normalizeAmount, '128,600.00', '128600.00')
t(normalizeAmount, '¥128,600', '128600.00')
t(normalizeAmount, '人民币128600元', '128600.00')
t(normalizeAmount, '12.5万元', '125000.00')
t(normalizeAmount, '壹拾贰万元整', '120000.00')
t(normalizeAmount, '贰佰叁拾捌万陆仟元', '2386000.00')
t(normalizeAmount, '壹佰贰拾叁元肆角伍分', '123.45')
t(normalizeAmount, '十二万', '120000.00')
t(normalizeAmount, '一亿二千万元', '120000000.00')
t(normalizeAmount, '捌佰陆拾万元整', '8600000.00')
t(normalizeAmount, 128600, '128600.00')
t(normalizeAmount, '', null)
t(normalizeAmount, '面议', null)
t(normalizeAmount, null, null)

console.log('\n\x1b[1m日期归一化\x1b[0m')
t(normalizeDate, '2026-08-01', '2026-08-01')
t(normalizeDate, '2026/8/1', '2026-08-01')
t(normalizeDate, '2026.08.01', '2026-08-01')
t(normalizeDate, '2026年8月1日', '2026-08-01')
t(normalizeDate, '2026年08月01号', '2026-08-01')
t(normalizeDate, '20260801', '2026-08-01')
t(normalizeDate, '2026-02-30', null)
t(normalizeDate, '2026-13-01', null)
t(normalizeDate, '待定', null)
t(normalizeDate, '', null)

console.log(`\n${'─'.repeat(56)}`)
console.log(fail === 0 ? `\x1b[32m\x1b[1m全部通过\x1b[0m ${pass} 项` : `\x1b[31m\x1b[1m${fail} 项失败\x1b[0m，${pass} 项通过`)
process.exit(fail === 0 ? 0 : 1)
