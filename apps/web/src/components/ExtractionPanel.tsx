import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  describeRedactions,
  formatFileSize,
  type ExtractionResult,
  type ExtractionStatus,
  type PagePreview,
  type RedactionRect,
} from '@contract/shared'
import { ApiError } from '../api/client'
import { extractionApi } from '../api/resources'
import { RedactionDialog } from './RedactionDialog'
import { Button, Spinner, cx } from './ui'

/**
 * 新建合同页顶部的识别入口。
 *
 * 没配 DEEPSEEK_API_KEY 时整块不渲染 —— 手工录入完全不受影响。
 */
export function ExtractionPanel({
  onExtracted,
  disabled,
}: {
  /** 识别成功后把结果和原文件交给表单：结果预填字段，原文件在保存后自动存为附件 */
  onExtracted: (result: ExtractionResult, file: File, redactions: RedactionRect[]) => void
  disabled?: boolean
}): ReactNode {
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [status, setStatus] = useState<(ExtractionStatus & { supportedMimes: string[] }) | null>(null)
  // 两步：先本地渲染预览让人涂抹，确认后才真的发出去
  const [stage, setStage] = useState<'idle' | 'preview' | 'redacting' | 'extracting'>('idle')
  const [pages, setPages] = useState<PagePreview[]>([])
  const [pending, setPending] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const busy = stage !== 'idle'

  useEffect(() => {
    const ac = new AbortController()
    extractionApi
      .status(ac.signal)
      .then((res) => setStatus(res.data))
      .catch(() => {
        /* 拿不到状态就当不可用，不打扰用户 */
      })
    return () => ac.abort()
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  /**
   * 第一步：本地渲染页面预览，打开涂抹界面。
   * 这一步**不出网** —— 只是把 PDF 渲染成图给人看着画框。
   */
  const run = async (file: File): Promise<void> => {
    setError(null)
    setFileName(file.name)
    setStage('preview')
    abortRef.current = new AbortController()
    try {
      const { data } = await extractionApi.preview(file, abortRef.current.signal)
      setPages(data)
      setPending(file)
      setStage('redacting')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof ApiError ? err.message : '打开文件失败，请换一份或手工录入')
      setFileName(null)
      setStage('idle')
    } finally {
      abortRef.current = null
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** 第二步：带着涂抹区去识别。被涂的内容不会出现在发出去的载荷里。 */
  const runExtract = async (rects: RedactionRect[]): Promise<void> => {
    if (!pending) return
    const file = pending
    setPages([])
    setPending(null)
    setStage('extracting')
    setError(null)
    abortRef.current = new AbortController()
    try {
      const { data } = await extractionApi.extract(file, rects, abortRef.current.signal)
      onExtracted(data, file, rects)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof ApiError ? err.message : '识别失败，请重试或手工录入')
      setFileName(null)
    } finally {
      setStage('idle')
      abortRef.current = null
    }
  }

  const cancelRedaction = (): void => {
    setPages([])
    setPending(null)
    setFileName(null)
    setStage('idle')
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (disabled || busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) void run(file)
  }

  // 没配 key（或状态还没拿到）就整块不渲染
  if (!status?.available) return null

  const accept = status.supportedMimes.join(',')

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled && !busy) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cx(
        'rounded-lg border-2 border-dashed px-4 py-4 transition-colors',
        dragging ? 'border-slate-500 bg-slate-100' : 'border-slate-300 bg-white',
        disabled && 'opacity-50',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {busy ? (
            <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <Spinner className="text-slate-600" />
              {stage === 'preview'
                ? `正在打开「${fileName}」…`
                : `正在识别「${fileName}」…扫描件通常需要 10–20 秒`}
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">
                上传合同文件，自动填写下面的字段
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                支持 PDF 和图片，也可以直接把文件拖到这里。
                <strong>选完文件可以先涂抹掉不想外发的内容</strong>，再开始识别。
              </p>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void run(f)
            }}
          />
          {busy ? (
            <Button size="sm" onClick={() => abortRef.current?.abort()}>
              取消
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              选择文件识别
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2.5 rounded bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      )}

      <p className="mt-2.5 border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-600">
        合同会上传到 DeepSeek 服务器完成识别 ——
        <strong>涂抹掉的部分不会发出去</strong>。整份都不希望出网的合同请直接手工录入。
      </p>

      <RedactionDialog
        open={stage === 'redacting'}
        fileName={fileName ?? ''}
        pages={pages}
        onCancel={cancelRedaction}
        onConfirm={(rects) => void runExtract(rects)}
      />
    </div>
  )
}

/** 识别完成后显示的结果条 */
export function ExtractionSummary({
  result,
  file,
  redactions,
  onClear,
}: {
  result: ExtractionResult
  file: File | null
  redactions: RedactionRect[]
  onClear: () => void
}): ReactNode {
  const { fieldCount, lowConfidenceCount, model, mode, pageCount, elapsedMs } = result.meta

  return (
    <div className="rounded-lg bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-900">
            {fieldCount === 0
              ? '没有从这份文件里识别出可用字段，请手工录入'
              : `已识别 ${fieldCount} 个字段${lowConfidenceCount > 0 ? `，其中 ${lowConfidenceCount} 项置信度较低，请重点核对` : '，请核对后保存'}`}
          </p>
          <p className="mt-1 text-xs text-emerald-700/80 tabular">
            {file && (
              <>
                {file.name}（{formatFileSize(file.size)}）·{' '}
              </>
            )}
            {pageCount} 页 · {mode === 'text' ? 'PDF 文本层' : '图像识别'} · {model} ·{' '}
            {(elapsedMs / 1000).toFixed(1)} 秒
          </p>
          {redactions.length > 0 && (
            <p className="mt-1 text-xs font-medium text-emerald-800">
              {describeRedactions(redactions)} —— 这些内容没有发出去，相关字段请手工填写
            </p>
          )}
          {file && (
            <p className="mt-1 text-xs text-emerald-700/80">
              保存后这份文件会自动存为该合同的附件（合同正本），不用再传一次。
            </p>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onClear} className="shrink-0">
          清除识别结果
        </Button>
      </div>
    </div>
  )
}
