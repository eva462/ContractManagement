import * as mupdf from 'mupdf'
import { ErrorCode, type RedactionRect } from '@contract/shared'
import { badRequest } from '../http/errors.js'
import { extractPageTextRedacted, paintRedactions, toPageRects } from './redact.js'

/**
 * 本地文档解析。**这一层永远不出网**，换 AI 供应商时完全不受影响。
 *
 * 两条路径：
 *   电子版 PDF（有文本层）→ 直接抽文字，准、便宜、无分辨率问题
 *   扫描件 PDF / 图片      → 渲染成图片再切块（见下方对 800×800 的说明）
 */

/** 渲染倍率。A4 在 2 倍下约 1190×1684，切 2×2 后每块 595×842，够清晰。 */
const RENDER_SCALE = 2

/**
 * 每页切几块。
 *
 * DeepSeek 会把每张图缩到约 800×800、每张封顶 384 token。A4 整页直接缩到
 * 800×800 的话，正文小字（金额、日期、编号）会糊成一团。切成 2×2 后每块
 * 只有半页内容，有效分辨率提高 4 倍。每请求最多 600 张图，10 页合同切完
 * 才 40 张，离上限很远。
 */
const TILE_COLS = 2
const TILE_ROWS = 2

/** 每页平均字符数低于这个值，就认为 PDF 没有可用文本层，是扫描件。 */
const TEXT_LAYER_MIN_CHARS_PER_PAGE = 50

/** 防止有人上传 500 页的文件把识别费用和耗时打爆 */
const MAX_PAGES = 30

export interface DocumentImage {
  /** PNG 二进制 */
  data: Buffer
  mimeType: 'image/png'
  pageIndex: number
  tileIndex: number
}

export type LoadedDocument =
  | { mode: 'text'; text: string; pageCount: number; fileName: string }
  | { mode: 'vision'; images: DocumentImage[]; pageCount: number; fileName: string }

export interface LoadInput {
  buffer: Buffer
  mimeType: string
  fileName: string
  /**
   * 涂抹区域。**这些内容不会出现在送去识别的载荷里** —— 文本路径逐字抠掉、
   * 图像路径填成纯黑。存档的原件不受影响。详见 extraction/redact.ts。
   */
  redactions?: RedactionRect[]
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export function loadDocument(input: LoadInput): LoadedDocument {
  if (input.mimeType === 'application/pdf') return loadPdf(input)
  if (IMAGE_MIMES.includes(input.mimeType)) {
    // 直传的图片不切块：用户自己拍的照片通常已经对准了单页，
    // 再切反而可能把一个字段从中间劈开。
    return {
      mode: 'vision',
      pageCount: 1,
      fileName: input.fileName,
      images: [{ data: input.buffer, mimeType: 'image/png', pageIndex: 0, tileIndex: 0 }],
    }
  }
  throw badRequest(
    ErrorCode.ATTACHMENT_TYPE_REJECTED,
    `识别暂不支持「${input.mimeType}」，请上传 PDF 或图片`,
  )
}

function loadPdf(input: LoadInput): LoadedDocument {
  let doc: mupdf.Document
  try {
    doc = mupdf.Document.openDocument(input.buffer, 'application/pdf')
  } catch {
    throw badRequest(ErrorCode.VALIDATION_FAILED, 'PDF 无法打开，文件可能已损坏')
  }

  if (doc.needsPassword()) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, 'PDF 有密码保护，请先解除密码再上传')
  }

  const pageCount = doc.countPages()
  if (pageCount === 0) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, 'PDF 里没有任何页面')
  }
  if (pageCount > MAX_PAGES) {
    throw badRequest(
      ErrorCode.VALIDATION_FAILED,
      `合同共 ${pageCount} 页，超过识别上限 ${MAX_PAGES} 页。请拆分后再传，或手工录入。`,
    )
  }

  const redactions = input.redactions ?? []
  const text = extractTextLayer(doc, pageCount, redactions)

  // 有像样的文本层就走文本路径 —— 又准又便宜，还没有分辨率问题
  if (text.length / pageCount >= TEXT_LAYER_MIN_CHARS_PER_PAGE) {
    return { mode: 'text', text, pageCount, fileName: input.fileName }
  }

  return {
    mode: 'vision',
    images: renderTiles(doc, pageCount, redactions),
    pageCount,
    fileName: input.fileName,
  }
}

function extractTextLayer(
  doc: mupdf.Document,
  pageCount: number,
  redactions: RedactionRect[],
): string {
  const parts: string[] = []
  for (let i = 0; i < pageCount; i++) {
    try {
      const page = doc.loadPage(i)
      const [px0, py0, px1, py1] = page.getBounds()
      const rects = toPageRects(redactions, i, px1 - px0, py1 - py0)
      // 逐字符抠掉涂抹区域。别改回读 asJSON 的行文本 —— 那样只有行级坐标，
      // 只能整行删，句子中间的金额抠不干净，上下文也会跟着丢。
      parts.push(extractPageTextRedacted(page, rects))
    } catch {
      // 单页抽不出来不影响其他页；真的整份都抽不出来，
      // 上面的字符数判断自然会把它归到扫描件路径
      parts.push('')
    }
  }
  return parts.join('\n\n').trim()
}

/**
 * 把每页渲染成 TILE_ROWS × TILE_COLS 块 PNG。
 *
 * 做法是给每一块建一个只覆盖该区域的 Pixmap，然后把整页画进去 ——
 * 落在区域外的内容自然被裁掉。这是 MuPDF 的标准分块渲染方式；
 * toPixmap 的最后一个参数是页面盒枚举（MediaBox/CropBox…），不是裁剪框，
 * 拿它传坐标会直接报 invalid enum value。
 */
function renderTiles(
  doc: mupdf.Document,
  pageCount: number,
  redactions: RedactionRect[],
): DocumentImage[] {
  const images: DocumentImage[] = []
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE)

  for (let p = 0; p < pageCount; p++) {
    const page = doc.loadPage(p)
    const [x0, y0, x1, y1] = page.getBounds()
    const rects = toPageRects(redactions, p, x1 - x0, y1 - y0)
    const width = Math.ceil((x1 - x0) * RENDER_SCALE)
    const height = Math.ceil((y1 - y0) * RENDER_SCALE)

    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        const bbox: [number, number, number, number] = [
          Math.floor((width * c) / TILE_COLS),
          Math.floor((height * r) / TILE_ROWS),
          Math.ceil((width * (c + 1)) / TILE_COLS),
          Math.ceil((height * (r + 1)) / TILE_ROWS),
        ]

        const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, false)
        pixmap.clear(255) // 白底，否则未绘制区域是黑的
        const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
        page.run(device, matrix)
        device.close()

        // 画完再涂 —— 必须在这一步之后，否则 page.run 会把内容重新画上来
        paintRedactions(pixmap, rects, RENDER_SCALE, bbox[0], bbox[1])

        images.push({
          data: Buffer.from(pixmap.asPNG()),
          mimeType: 'image/png',
          pageIndex: p,
          tileIndex: r * TILE_COLS + c,
        })
      }
    }
  }

  return images
}

/** 一页预览图，前端拿它当画布拉涂抹框 */
export interface PagePreview {
  pageIndex: number
  /** base64 PNG（data URI 的 payload 部分） */
  imageBase64: string
  /** 渲染出来的像素尺寸，前端按这个比例换算归一化坐标 */
  width: number
  height: number
}

/** 预览用的渲染倍率。比识别用的低 —— 只是给人看着画框，不用那么清晰。 */
const PREVIEW_SCALE = 1.2

/**
 * 渲染每页的预览图。**纯本地，不出网**，这一步不调任何模型。
 *
 * 前端需要它才能让用户在图上拉涂抹框；坐标最终按页面比例归一化回来，
 * 所以这里的渲染倍率和识别时用多少无关。
 */
export function renderPagePreviews(input: LoadInput): PagePreview[] {
  if (IMAGE_MIMES.includes(input.mimeType)) {
    // 直传的图片本身就是预览图
    const pix = new mupdf.Image(input.buffer).toPixmap()
    return [
      {
        pageIndex: 0,
        imageBase64: Buffer.from(pix.asPNG()).toString('base64'),
        width: pix.getWidth(),
        height: pix.getHeight(),
      },
    ]
  }

  if (input.mimeType !== 'application/pdf') {
    throw badRequest(
      ErrorCode.ATTACHMENT_TYPE_REJECTED,
      `不支持预览「${input.mimeType}」，请上传 PDF 或图片`,
    )
  }

  let doc: mupdf.Document
  try {
    doc = mupdf.Document.openDocument(input.buffer, 'application/pdf')
  } catch {
    throw badRequest(ErrorCode.VALIDATION_FAILED, 'PDF 无法打开，文件可能已损坏')
  }
  if (doc.needsPassword()) {
    throw badRequest(ErrorCode.VALIDATION_FAILED, 'PDF 有密码保护，请先解除密码再上传')
  }

  const pageCount = doc.countPages()
  if (pageCount > MAX_PAGES) {
    throw badRequest(
      ErrorCode.VALIDATION_FAILED,
      `合同共 ${pageCount} 页，超过上限 ${MAX_PAGES} 页`,
    )
  }

  const previews: PagePreview[] = []
  const matrix = mupdf.Matrix.scale(PREVIEW_SCALE, PREVIEW_SCALE)
  for (let p = 0; p < pageCount; p++) {
    const pix = doc
      .loadPage(p)
      .toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true)
    previews.push({
      pageIndex: p,
      imageBase64: Buffer.from(pix.asPNG()).toString('base64'),
      width: pix.getWidth(),
      height: pix.getHeight(),
    })
  }
  return previews
}

export const documentLoaderConfig = {
  renderScale: RENDER_SCALE,
  tileCols: TILE_COLS,
  tileRows: TILE_ROWS,
  maxPages: MAX_PAGES,
  supportedMimes: ['application/pdf', ...IMAGE_MIMES],
}
