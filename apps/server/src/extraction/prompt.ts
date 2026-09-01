import {
  AMOUNT_TYPE_LABEL,
  AMOUNT_TYPE_VALUES,
  CONTRACT_TYPE_SEED_LABEL,
  CONTRACT_TYPE_SEED_VALUES,
  CURRENCY_VALUES,
} from '@contract/shared'
import type { LoadedDocument } from './document-loader.js'

/**
 * 提示词。刻意和具体供应商解耦 —— DeepSeek 和 Qwen 用完全同一套，
 * 这样对比两家准确率时，差异来自模型本身而不是提示词。
 */

export interface ChatContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

const typeOptions = CONTRACT_TYPE_SEED_VALUES.map((v) => `${v}(${CONTRACT_TYPE_SEED_LABEL[v]})`).join('、')
const amountOptions = AMOUNT_TYPE_VALUES.map((v) => `${v}(${AMOUNT_TYPE_LABEL[v]})`).join('、')

export const SYSTEM_PROMPT = `你是合同信息抽取助手。用户会给你一份中文合同（文本或扫描图片），
你要从中读出结构化字段，以 json 格式返回。

必须遵守的规则：
1. **只填你在合同里真正读到的内容。读不到就不要放进结果里，绝对不要猜测或编造。**
   漏掉一个字段的代价，远小于填错一个金额或日期。
2. 每个字段都要给出 confidence 和 evidence：
   - confidence: "high" 明确写在合同里 / "medium" 需要推断 / "low" 模糊不清或多处冲突
   - evidence: 你据以判断的原文片段（30 字以内），方便人工核对
3. 日期一律输出 YYYY-MM-DD。合同里写「二〇二六年八月一日」也要转成 2026-08-01。
4. 金额只输出数字，不要千分位、不要币种符号、不要「元」「万元」。
   「壹拾贰万元整」输出 120000.00，「128,600 元」输出 128600.00。
5. 枚举字段只能用下列取值之一：
   - contractType: ${typeOptions}
   - amountType: ${amountOptions}
   - currency: ${CURRENCY_VALUES.join('、')}
6. 只输出 json 本身，不要包在 markdown 代码块里，不要写任何解释文字。

要抽的字段一共 13 个，**每一个都要尝试去找**，不要只找示例里出现过的那几个：

| 字段 | 含义与常见位置 |
|---|---|
| contractNo | 合同编号，通常在标题下方或页眉，形如「合同编号：XXX」 |
| title | 合同名称，通常是文档标题 |
| contractType | 合同类型，从标题和正文判断 |
| counterpartyName | **对方**单位全称。我方是甲方时对方就是乙方，反之亦然。分不清就用 low |
| counterpartyContact | 对方的联系人姓名，常写在对方信息块里「联系人：XXX」 |
| amountType | 含税/不含税/无金额。正文出现「含税」「价税合计」→ TAX_INCLUDED |
| amount | 合同总金额 |
| currency | 币种，出现「人民币」「RMB」→ CNY |
| paymentTerms | 付款方式条款原文，常在「付款方式」「结算方式」条款下 |
| signDate | 签订日期，常在文末落款处 |
| effectiveDate | **生效日期**。常在「合同期限」「有效期」条款里，形如「本合同自 X 起生效」。找不到明确生效日期时可用签订日期，但 confidence 标 medium |
| expiryDate | **到期日期**。常与生效日期同一句，形如「至 Y 终止／到期」 |
| isPerpetual | 写明长期有效／无固定期限时为 true，否则不要输出这个字段 |

⚠️ effectiveDate 和 expiryDate 经常和 signDate 写在不同段落，容易漏 —— 请专门到「合同期限」「有效期」「履行期限」这类条款里再找一遍。

下面的示例**只是演示格式**，不是字段清单 —— 上表 13 个字段凡是读得到的都要输出：
{
  "contractNo":       { "value": "CG-2026-0007", "confidence": "high",   "evidence": "合同编号：CG-2026-0007" },
  "title":            { "value": "办公家具采购合同", "confidence": "high", "evidence": "标题：办公家具采购合同" },
  "contractType":     { "value": "PURCHASE",     "confidence": "high",   "evidence": "采购合同" },
  "counterpartyName": { "value": "恒信办公设备有限公司", "confidence": "high", "evidence": "乙方：恒信办公设备有限公司" },
  "amountType":       { "value": "TAX_INCLUDED", "confidence": "medium", "evidence": "含税总价" },
  "amount":           { "value": "128600.00",    "confidence": "high",   "evidence": "人民币壹拾贰万捌仟陆佰元整" },
  "currency":         { "value": "CNY",          "confidence": "high",   "evidence": "人民币" },
  "signDate":         { "value": "2026-08-01",   "confidence": "high",   "evidence": "签订日期：2026年8月1日" }
}`

export function buildUserContent(
  doc: LoadedDocument,
  attempt: number,
): string | ChatContentPart[] {
  // 重试时加一句更强的约束。DeepSeek 官方也建议靠改提示词绕开偶发空返回。
  const retryHint =
    attempt > 1
      ? '\n\n注意：上一次没有返回可用结果。请再仔细看一遍，把能确定的字段以 json 返回；确实读不到就返回 {}。'
      : ''

  if (doc.mode === 'text') {
    return `以下是合同《${doc.fileName}》的全文，请抽取字段并以 json 返回。${retryHint}

--- 合同正文开始 ---
${doc.text.slice(0, 120_000)}
--- 合同正文结束 ---`
  }

  const parts: ChatContentPart[] = [
    {
      type: 'text',
      text: `以下是合同《${doc.fileName}》的扫描图片，共 ${doc.pageCount} 页、${doc.images.length} 张切图（每页按左上、右上、左下、右下切成 4 块，按顺序排列）。请通读后抽取字段并以 json 返回。${retryHint}`,
    },
  ]
  for (const img of doc.images) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data.toString('base64')}` },
    })
  }
  return parts
}
