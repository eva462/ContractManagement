#!/usr/bin/env node
/**
 * 生成两份内容完全相同的测试合同，用于验证识别效果：
 *
 *   var/sample/电子版合同.pdf   带中文文本层  → 走文本路径
 *   var/sample/扫描件合同.pdf   纯图片无文本层 → 走图片切块路径
 *
 * 内容里刻意埋了几个容易出错的点：
 *   - 甲方是我方、乙方是对方，看模型会不会填反
 *   - 金额同时给中文大写和阿拉伯数字
 *   - 签订日期用「二〇二六年三月十二日」这种中文数字写法
 *   - 生效/到期用另一种日期格式，看归一化是否都能吃下
 *
 * 这是我生成的假合同，不是任何真实数据。
 */
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as mupdf from 'mupdf'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = resolve(root, 'var/sample')
mkdirSync(outDir, { recursive: true })

/**
 * 找一个能画中文的字体。各平台自带的位置不一样，挨个试。
 * 都找不到的话用 SAMPLE_FONT 环境变量指一个 .ttf/.otf。
 *
 * 注意只收 .ttf/.otf —— .ttc 是字体集合，pdf-lib 的 embedFont 吃不下。
 */
const FONT_CANDIDATES = [
  process.env.SAMPLE_FONT,
  // Windows
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/Deng.ttf',
  'C:/Windows/Fonts/SimsunExtG.ttf',
  // macOS
  '/System/Library/Fonts/Supplemental/Songti.ttc'.replace(/\.ttc$/, '.ttf'),
  '/Library/Fonts/Arial Unicode.ttf',
  // Linux（Noto CJK 常见安装位置）
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.otf',
  '/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttf',
].filter(Boolean)

const FONT = FONT_CANDIDATES.find((p) => existsSync(p))
if (!FONT) {
  console.error('找不到可用的中文字体，无法生成样本合同。')
  console.error('这个脚本只是用来造测试数据的，不影响系统本身运行。')
  console.error('')
  console.error('想用的话，指一个中文 .ttf 或 .otf 字体：')
  console.error('  SAMPLE_FONT=/path/to/font.ttf npm run sample -w apps/server')
  console.error('')
  console.error('试过这些位置：')
  for (const p of FONT_CANDIDATES) console.error('  ' + p)
  process.exit(1)
}

/** 正确答案，用于比对识别结果 */
export const EXPECTED = {
  contractNo: 'CG-2026-0083',
  title: '办公设备采购合同',
  contractType: 'PURCHASE',
  counterpartyName: '恒信办公设备有限公司', // 乙方，不是甲方
  counterpartyContact: '李国强',
  amountType: 'TAX_INCLUDED',
  amount: '128600.00',
  currency: 'CNY',
  signDate: '2026-03-12', // 原文是「二〇二六年三月十二日」
  effectiveDate: '2026-03-15',
  expiryDate: '2027-03-14',
}

const LINES = [
  ['title', '办公设备采购合同'],
  ['gap', ''],
  ['right', '合同编号：CG-2026-0083'],
  ['gap', ''],
  ['body', '甲方（采购方）：星辰科技（深圳）有限公司'],
  ['body', '统一社会信用代码：91440300MA5XXXXX1J'],
  ['body', '地址：深圳市南山区科技园南区柏华路 18 号'],
  ['gap', ''],
  ['body', '乙方（供应方）：恒信办公设备有限公司'],
  ['body', '统一社会信用代码：91440300MA5YYYYY7K'],
  ['body', '联系人：李国强          联系电话：0755-8888 6612'],
  ['gap', ''],
  ['body', '根据《中华人民共和国民法典》及相关法律法规，甲乙双方经友好协商，'],
  ['body', '就甲方向乙方采购办公设备事宜达成如下协议：'],
  ['gap', ''],
  ['h2', '第一条  采购内容'],
  ['body', '乙方向甲方供应升降办公桌 40 张、人体工学椅 40 把、会议桌 2 张，'],
  ['body', '具体规格型号以附件《设备清单》为准。'],
  ['gap', ''],
  ['h2', '第二条  合同金额'],
  ['body', '本合同总金额为人民币壹拾贰万捌仟陆佰元整（¥128,600.00），'],
  ['body', '该金额为含税价，增值税税率 13%，由乙方开具增值税专用发票。'],
  ['gap', ''],
  ['h2', '第三条  付款方式'],
  ['body', '甲方于合同签订后 5 个工作日内支付合同总额的 30% 作为预付款；'],
  ['body', '设备验收合格后 15 个工作日内支付 60%；'],
  ['body', '剩余 10% 作为质保金，质保期满 12 个月且无质量问题后一次性付清。'],
  ['gap', ''],
  // 真实合同的收款信息就在付款条款里。样本刻意带上银行账号、手机号、
  // 身份证号（都是编的），好让涂抹的敏感信息检测有真东西可测。
  ['body', '乙方收款账户：'],
  ['body', '开户行：中国建设银行深圳科技园支行'],
  ['body', '户名：恒信办公设备有限公司      账号：6217 0012 3456 7890 123'],
  ['body', '财务联系人：周敏      手机：13800138000'],
  ['body', '法定代表人：李国强      身份证号：440301199003072316'],
  ['gap', ''],
  ['h2', '第四条  合同期限'],
  ['body', '本合同自 2026 年 3 月 15 日起生效，至 2027 年 3 月 14 日终止。'],
  ['gap', ''],
  ['h2', '第五条  其他'],
  ['body', '本合同一式肆份，甲乙双方各执贰份，具有同等法律效力。'],
  ['body', '未尽事宜，双方另行协商并签订补充协议。'],
  ['gap', ''],
  ['gap', ''],
  ['body', '甲方（盖章）：星辰科技（深圳）有限公司      乙方（盖章）：恒信办公设备有限公司'],
  ['gap', ''],
  ['body', '授权代表：                                  授权代表：'],
  ['gap', ''],
  ['body', '签订日期：二〇二六年三月十二日              签订日期：二〇二六年三月十二日'],
]

async function buildTextPdf() {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(readFileSync(FONT), { subset: true })
  const page = doc.addPage([595, 842])

  let y = 790
  const left = 62
  for (const [kind, text] of LINES) {
    if (kind === 'gap') {
      y -= 9
      continue
    }
    const size = kind === 'title' ? 17 : kind === 'h2' ? 11.5 : 10
    let x = left
    if (kind === 'title') x = (595 - font.widthOfTextAtSize(text, size)) / 2
    if (kind === 'right') x = 595 - 62 - font.widthOfTextAtSize(text, size)
    page.drawText(text, { x, y, size, font, color: rgb(0.08, 0.08, 0.08) })
    y -= kind === 'title' ? 30 : kind === 'h2' ? 20 : 16
  }

  const bytes = await doc.save()
  const p = resolve(outDir, '电子版合同.pdf')
  writeFileSync(p, bytes)
  return p
}

/** 把电子版渲染成图片再塞进 PDF，得到一份没有文本层的「扫描件」 */
async function buildScannedPdf(textPdfPath) {
  const src = mupdf.Document.openDocument(readFileSync(textPdfPath), 'application/pdf')
  // 用 1.6 倍渲染，模拟普通办公扫描仪的分辨率（约 150dpi），不给识别开小灶
  const pix = src
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true)
  const png = Buffer.from(pix.asPNG())

  const doc = await PDFDocument.create()
  const img = await doc.embedPng(png)
  const page = doc.addPage([595, 842])
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })

  const p = resolve(outDir, '扫描件合同.pdf')
  writeFileSync(p, await doc.save())
  return p
}

const textPdf = await buildTextPdf()
const scanned = await buildScannedPdf(textPdf)
console.log('已生成：')
console.log('  ' + textPdf)
console.log('  ' + scanned)
