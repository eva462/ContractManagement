import {
  ErrorCode,
  RISK_SEVERITY_RANK,
  RawFindingSchema,
  parseRedactions,
  type ContractReviewDto,
  type RawFinding,
  type ReviewTemplateDto,
  type RiskSeverity,
} from '@contract/shared'
import { callJsonModel } from '../../ai/json-chat.js'
import { db } from '../../db.js'
import { storage } from '../../context.js'
import { loadDocument } from '../../extraction/document-loader.js'
import { activeProviderConfig } from '../../extraction/providers.js'
import { notFound } from '../../http/errors.js'
import { GENERIC_REVIEW_RULES } from './rules-seed.js'

/**
 * 合同风险审查。
 *
 * **定位是给审核人看的辅助材料，不阻断任何流转。** 甲方原话：「原本有合同
 * 审核人员，增加 deepseek 审核环节只是简化条款审核工作，提升效率」。
 *
 * 防幻觉靠两件事，都不能放宽：
 *   1. 按**可编辑的规则模板**审，而不是笼统地问「这合同有风险吗」
 *   2. **没有原文依据的风险点直接丢弃**，不入库
 */

/* ── 模板与规则 ─────────────────────────────────────────────────────── */

/** 建库后第一次用时自动创建通用模板。幂等。 */
export async function ensureGenericTemplate(): Promise<string> {
  const existing = await db.reviewTemplate.findFirst({
    where: { contractType: null },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await db.reviewTemplate.create({
    data: {
      contractType: null,
      name: '通用审查模板',
      rules: {
        create: GENERIC_REVIEW_RULES.map((r, i) => ({
          title: r.title,
          detail: r.detail,
          severity: r.severity,
          sortOrder: i * 10,
          isDraft: false,
        })),
      },
    },
    select: { id: true },
  })
  return created.id
}

/**
 * 找该合同类型该用哪套模板：有专属的用专属，没有就用通用兜底。
 *
 * 当前只做了通用模板（按用户选择）。以后要按类型细分，往表里加数据即可，
 * 这个函数和调用方都不用改。
 */
async function resolveTemplate(contractType: string | null) {
  await ensureGenericTemplate()
  if (contractType) {
    const specific = await db.reviewTemplate.findFirst({
      where: { contractType, isActive: true },
      include: { rules: { where: { isActive: true, isDraft: false }, orderBy: { sortOrder: 'asc' } } },
    })
    if (specific && specific.rules.length > 0) return specific
  }
  return db.reviewTemplate.findFirst({
    where: { contractType: null },
    include: { rules: { where: { isActive: true, isDraft: false }, orderBy: { sortOrder: 'asc' } } },
  })
}

export async function listTemplates(): Promise<ReviewTemplateDto[]> {
  await ensureGenericTemplate()
  const rows = await db.reviewTemplate.findMany({
    include: { rules: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { contractType: { sort: 'asc', nulls: 'first' } },
  })
  return rows.map((t) => ({
    id: t.id,
    contractType: t.contractType,
    name: t.name,
    isActive: t.isActive,
    rules: t.rules.map((r) => ({
      id: r.id,
      title: r.title,
      detail: r.detail,
      severity: r.severity as RiskSeverity,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      isDraft: r.isDraft,
    })),
  }))
}

/* ── 合同正文 ───────────────────────────────────────────────────────── */

/**
 * 取一份合同的可审查正文。
 *
 * 来源是**合同正本附件**，因为审条款必须看全文，光靠结构化字段审不出什么。
 *
 * ⚠️ 关键：附件在存档时是**完整的原件**，但这里要沿用上传者当初的涂抹决定 ——
 * 否则等于把用户特意涂掉的内容又发了一遍。涂抹区随附件一起存在
 * contract_attachments.redactions 里。
 */
async function loadContractText(
  contractId: string,
): Promise<{ text: string; redactedCount: number } | null> {
  // **要遍历所有正本，不能只看最新那一份。** 归档时会再传一份签署后的扫描件，
  // 它会变成最新的 ORIGINAL —— 只取最新的话，合同一归档，重新审查就永远失败，
  // 哪怕当初那份电子版还好好地躺在附件里。
  const originals = await db.contractAttachment.findMany({
    where: { contractId, attachmentType: 'ORIGINAL' },
    orderBy: { uploadedAt: 'desc' },
  })

  for (const original of originals) {
    // 存储层只给流（S3 之类的实现也是流），这里读成 buffer 交给 mupdf
    const chunks: Buffer[] = []
    const stream = await storage.createReadStream(original.storageKey)
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
    const buffer = Buffer.concat(chunks)

    const redactions = parseRedactions(original.redactions)

    let doc
    try {
      doc = loadDocument({
        buffer,
        mimeType: original.mimeType,
        fileName: original.fileName,
        redactions,
      })
    } catch {
      // 这份打不开（.docx、加密 PDF、超 30 页、文件损坏）就试下一份。
      // **不能让异常冒出去** —— runReview 里那条 RUNNING 记录会永远卡在
      // RUNNING，前端每 4 秒轮询一次，转圈转到天荒地老。
      continue
    }

    // 扫描件走图片路径，这里拿不到文本 —— 审查暂时只支持有文本层的合同。
    // 图片审查要把切图一起送过去，成本和提示词都不一样，留到以后再说。
    if (doc.mode === 'text') return { text: doc.text, redactedCount: redactions.length }
  }

  return null
}

/* ── 执行审查 ───────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `你是合同审查助手。用户会给你一份中文合同的正文，以及一份审查要点清单。
你要**逐条**按清单去合同里找问题，以 json 返回。

必须遵守：
1. **每个风险点都必须给出 evidence —— 合同原文里的原句**。找不到原文支撑的，
   就不要输出这一条。宁可少报，不可编造。
2. 只按给定的审查要点找，不要自由发挥别的角度。
3. 没发现问题的要点就不输出，不要为了凑数写「未发现异常」。
4. summary 说清楚**问题是什么、对我方有什么不利**，不要复述原文。
5. suggestion 给出可操作的修改建议，没有就留空。
6. ruleTitle 必须**原样照抄**清单里的标题，方便回溯是哪条规则命中的。
7. 只输出 json 本身，不要包在 markdown 代码块里。

返回格式：
{
  "findings": [
    {
      "ruleTitle": "金额大小写是否一致",
      "severity": "HIGH",
      "summary": "大写金额与数字金额不一致，相差 1 万元，争议时会有解释分歧",
      "evidence": "人民币壹拾贰万捌仟陆佰元整（138,600.00）",
      "suggestion": "核对实际成交价后统一两处金额，并双方签字确认"
    }
  ]
}

如果通篇没有发现任何符合清单的问题，返回 {"findings": []}。`

function buildUserPrompt(
  rules: { title: string; detail: string; severity: string }[],
  contractText: string,
  redactedCount: number,
): string {
  const list = rules
    .map((r, i) => `${i + 1}. 【${r.title}】（建议严重度 ${r.severity}）\n   ${r.detail}`)
    .join('\n')

  const redactNote =
    redactedCount > 0
      ? `\n注意：这份合同有 ${redactedCount} 处内容被人工涂抹（显示为「〔已涂抹〕」），` +
        `那些部分不参与审查，不要因为读不到而报告问题。\n`
      : ''

  return `审查要点清单：

${list}
${redactNote}
--- 合同正文开始 ---
${contractText.slice(0, 100_000)}
--- 合同正文结束 ---

请逐条对照清单审查，以 json 返回发现的问题。记住：每条都要有合同原文依据。`
}

/**
 * 跑一次审查并落库。
 *
 * 调用方通常**不等它**（提交审核时后台跑），所以这里自己管好状态：
 * 先建一条 RUNNING 记录，跑完改 DONE/FAILED。这样界面随时能显示进度，
 * 服务重启导致的半途而废也看得出来（会一直停在 RUNNING，可手动重跑）。
 */
/**
 * 把原文和「原文依据」都归一化后再比对。
 *
 * 直接字符串相等会误杀：PDF 抽出来的文字带各种换行和空格，模型引用时通常
 * 会顺手抹平。所以两边都去掉所有空白，并把中英文标点对齐再比。
 *
 * 宁可稍微宽松一点，也不要把**真实存在**的依据判成幻觉 —— 那会让用户
 * 反过来不信任这道闸。但绝不能宽松到「差不多就算」：模糊匹配一旦引入，
 * 编造的句子就能蒙混过关，这道闸也就白设了。
 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[，,]/g, ',')
    .replace(/[。.]/g, '.')
    .replace(/[；;]/g, ';')
    .replace(/[：:]/g, ':')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/[「」“”"']/g, '"')
    .replace(/[–—\-]/g, '-')
}

/**
 * 「原文依据」是不是真能在合同里找到。
 *
 * haystack 要先过一遍 normalizeForMatch，别在循环里重复归一化整篇正文。
 */
export function evidenceFoundIn(normalizedText: string, evidence: string): boolean {
  const needle = normalizeForMatch(evidence)
  // 太短的片段谁都能命中（比如「合同」两个字），等于没验
  if (needle.length < 4) return false
  return normalizedText.includes(needle)
}

export async function runReview(
  contractId: string,
  actorId: string | null,
): Promise<ContractReviewDto> {
  const contract = await db.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: { id: true, contractType: true },
  })
  if (!contract) throw notFound(ErrorCode.CONTRACT_NOT_FOUND, '合同不存在')

  const template = await resolveTemplate(contract.contractType)
  const review = await db.contractReview.create({
    data: {
      contractId,
      templateId: template?.id ?? null,
      createdById: actorId,
      status: 'RUNNING',
    },
  })

  const startedAt = Date.now()
  const fail = async (message: string): Promise<ContractReviewDto> => {
    await db.contractReview.update({
      where: { id: review.id },
      data: {
        status: 'FAILED',
        error: message,
        elapsedMs: Date.now() - startedAt,
        finishedAt: new Date(),
      },
    })
    return (await getReview(review.id))!
  }

  const config = activeProviderConfig()
  if (!config) return fail('未配置识别服务的 API key，无法执行 AI 审查')
  if (!template || template.rules.length === 0) {
    return fail('没有可用的审查规则，请先在设置里配置')
  }

  const loaded = await loadContractText(contractId)
  if (!loaded) {
    return fail(
      '需要一份带文字的合同正本附件才能审查。扫描件目前审不了 —— 请上传电子版 PDF，或跳过 AI 审查直接人工审。',
    )
  }

  let raw: Record<string, unknown>
  try {
    raw = await callJsonModel(
      { ...config, model: config.textModel },
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildUserPrompt(template.rules, loaded.text, loaded.redactedCount),
        },
      ],
      { maxTokens: 6000 },
    )
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }

  // 逐条校验。**没有原文依据的直接丢弃** —— 这是防幻觉最有效的一招。
  const list = Array.isArray(raw.findings) ? raw.findings : []
  const valid: RawFinding[] = []
  let malformed = 0
  let unfounded = 0
  const haystack = normalizeForMatch(loaded.text)
  for (const item of list) {
    const parsed = RawFindingSchema.safeParse(item)
    if (!parsed.success) {
      malformed++
      continue
    }
    // **光要求模型给 evidence 是不够的 —— 它完全可以编一句像模像样的。**
    // 必须回头到原文里核一遍：对不上就是幻觉，丢掉。
    if (!evidenceFoundIn(haystack, parsed.data.evidence)) {
      unfounded++
      console.warn(`[review] 依据在原文里找不到，丢弃：${parsed.data.evidence.slice(0, 40)}`)
      continue
    }
    valid.push(parsed.data)
  }
  if (malformed > 0 || unfounded > 0) {
    console.warn(`[review] 丢弃 ${malformed} 条格式不合规、${unfounded} 条依据对不上原文`)
  }

  valid.sort((a, b) => RISK_SEVERITY_RANK[a.severity] - RISK_SEVERITY_RANK[b.severity])

  await db.$transaction(async (tx) => {
    await tx.contractReview.update({
      where: { id: review.id },
      data: {
        status: 'DONE',
        model: config.textModel,
        elapsedMs: Date.now() - startedAt,
        redactedCount: loaded.redactedCount,
        finishedAt: new Date(),
      },
    })
    if (valid.length > 0) {
      await tx.reviewFinding.createMany({
        data: valid.map((f, i) => ({
          reviewId: review.id,
          ruleTitle: f.ruleTitle,
          severity: f.severity,
          summary: f.summary,
          evidence: f.evidence,
          suggestion: f.suggestion,
          sortOrder: i,
        })),
      })
    }
  })

  return (await getReview(review.id))!
}

export async function getReview(id: string): Promise<ContractReviewDto | null> {
  const row = await db.contractReview.findUnique({
    where: { id },
    include: {
      findings: { orderBy: { sortOrder: 'asc' } },
      createdBy: { select: { displayName: true } },
    },
  })
  return row ? toDto(row) : null
}

/** 详情页要显示的那一次：最近一次。 */
export async function latestReview(contractId: string): Promise<ContractReviewDto | null> {
  const row = await db.contractReview.findFirst({
    where: { contractId },
    orderBy: { createdAt: 'desc' },
    include: {
      findings: { orderBy: { sortOrder: 'asc' } },
      createdBy: { select: { displayName: true } },
    },
  })
  return row ? toDto(row) : null
}

function toDto(row: {
  id: string
  status: string
  model: string | null
  error: string | null
  elapsedMs: number | null
  redactedCount: number
  createdAt: Date
  finishedAt: Date | null
  createdBy: { displayName: string } | null
  findings: {
    id: string
    ruleTitle: string
    severity: string
    summary: string
    evidence: string
    suggestion: string | null
  }[]
}): ContractReviewDto {
  return {
    id: row.id,
    status: row.status as ContractReviewDto['status'],
    model: row.model,
    error: row.error,
    elapsedMs: row.elapsedMs,
    redactedCount: row.redactedCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdByName: row.createdBy?.displayName ?? null,
    findings: row.findings.map((f) => ({
      id: f.id,
      ruleTitle: f.ruleTitle,
      severity: f.severity as RiskSeverity,
      summary: f.summary,
      evidence: f.evidence,
      suggestion: f.suggestion,
    })),
  }
}

/**
 * 提交审核后在后台跑一次审查。**不阻塞提交** —— AI 调用要 10–40 秒，
 * 不能让用户点了「提交审核」之后干等这么久。
 *
 * 跑失败只写进那条 review 记录，绝不影响合同状态：审查是辅助材料，不是关卡。
 */
export function scheduleReview(contractId: string, actorId: string | null): void {
  void runReview(contractId, actorId).catch((err) => {
    console.error('[review] 后台审查异常', err)
  })
}
