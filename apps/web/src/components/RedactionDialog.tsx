import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import type { PagePreview, RedactionRect } from '@contract/shared'
import { Modal } from './overlays'
import { Button, cx } from './ui'

/**
 * 涂抹界面：在页面预览图上拉矩形，框住的内容不会发给识别服务。
 *
 * ⚠️ 这里画的框**不是**盖在 PDF 上的黑块 —— 坐标会送到服务端，
 * 由 extraction/redact.ts 把对应内容从「送去识别的副本」里真的抠掉
 * （文本层逐字符剔除、扫描件涂像素）。存档的原件不受影响。
 */

/** 拉得太小的当误触，不产生涂抹框 */
const MIN_SIZE = 0.008

export function RedactionDialog({
  open,
  fileName,
  pages,
  onCancel,
  onConfirm,
}: {
  open: boolean
  fileName: string
  pages: PagePreview[]
  onCancel: () => void
  /** 确认后把涂抹区交出去，交给识别接口 */
  onConfirm: (rects: RedactionRect[]) => void
}): ReactNode {
  const [rects, setRects] = useState<RedactionRect[]>([])
  const [drawing, setDrawing] = useState<RedactionRect | null>(null)
  const startRef = useRef<{ x: number; y: number; page: number } | null>(null)
  // 正在画的框同时存一份 ref。onUp 从 ref 读而不是从闭包读 —— 闭包里的值
  // 取决于 React 有没有在 down 和 up 之间重渲染过，那是个不该依赖的时机。
  const drawingRef = useRef<RedactionRect | null>(null)

  const setDraft = (rect: RedactionRect | null): void => {
    drawingRef.current = rect
    setDrawing(rect)
  }

  const posIn = (e: PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const box = e.currentTarget.getBoundingClientRect()
    return {
      // 归一化成页面比例 —— 预览图的缩放和后端渲染的缩放不一样，用像素必错
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    }
  }

  const onDown = (page: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    // 捕获指针，手拖出画布外也不会丢事件。某些环境（合成事件、部分 WebView）
    // 会抛 NotFoundError —— 抓不到就算了，正常拖拽照样能用。
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 捕获失败不影响主流程 */
    }
    const p = posIn(e)
    startRef.current = { ...p, page }
    setDraft({ page, x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    const s = startRef.current
    if (!s) return
    const p = posIn(e)
    setDraft({
      page: s.page,
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    })
  }

  const onUp = (): void => {
    startRef.current = null
    // 别把 setRects 写进 setDrawing 的更新函数里 —— React 严格模式会把更新函数
    // 跑两遍，一次拖拽就会产生两个涂抹框。状态更新函数必须是纯的。
    const d = drawingRef.current
    if (d && d.w > MIN_SIZE && d.h > MIN_SIZE) {
      setRects((prev) => [...prev, d])
    }
    setDraft(null)
  }

  const removeAt = useCallback((idx: number) => {
    setRects((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const total = rects.length

  return (
    <Modal
      open={open}
      width="lg"
      title="涂抹后再识别"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>取消</Button>
          <Button onClick={() => onConfirm([])} title="整份原样发给识别服务">
            不涂抹，直接识别
          </Button>
          <Button variant="primary" onClick={() => onConfirm(rects)}>
            {total > 0 ? `涂抹 ${total} 处并识别` : '开始识别'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-sky-200">
          在页面上<strong>按住拖动</strong>框选不想发出去的内容（通常是金额）。
          框住的部分<strong>不会发给识别服务</strong>，识别结果里这些字段会留空，保存前手工填就行。
          <span className="mt-1 block text-xs text-sky-700/90">
            涂抹只影响送去识别的副本 —— 存进系统的合同原件是完整的。
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-600">
            {fileName} · 共 {pages.length} 页
            {total > 0 && <span className="ml-2 text-slate-800">已涂 {total} 处</span>}
          </p>
          {total > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setRects([])}>
              全部清除
            </Button>
          )}
        </div>

        <div className="flex max-h-[58vh] flex-col gap-4 overflow-y-auto rounded-md bg-slate-100 p-3">
          {pages.map((page) => {
            const pageRects = rects
              .map((r, i) => ({ r, i }))
              .filter(({ r }) => r.page === page.pageIndex)

            return (
              <div key={page.pageIndex} className="flex flex-col gap-1">
                <span className="text-xs text-slate-600">第 {page.pageIndex + 1} 页</span>
                <div
                  onPointerDown={onDown(page.pageIndex)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                  className="relative w-full cursor-crosshair touch-none overflow-hidden rounded ring-1 ring-slate-300 select-none"
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                >
                  <img
                    src={`data:image/png;base64,${page.imageBase64}`}
                    alt={`第 ${page.pageIndex + 1} 页`}
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full bg-white object-contain"
                  />

                  {pageRects.map(({ r, i }) => (
                    <button
                      key={i}
                      type="button"
                      title="点一下删除这块涂抹"
                      onPointerDown={(e) => {
                        // 别让点击穿透到画布上又开始画新框
                        e.stopPropagation()
                        removeAt(i)
                      }}
                      className="group absolute bg-slate-900/85 ring-2 ring-slate-900 hover:bg-rose-600/80 hover:ring-rose-600"
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.w * 100}%`,
                        height: `${r.h * 100}%`,
                      }}
                    >
                      <span className="pointer-events-none absolute inset-0 hidden items-center justify-center text-[10px] font-medium text-white group-hover:flex">
                        点击删除
                      </span>
                    </button>
                  ))}

                  {drawing && drawing.page === page.pageIndex && (
                    <div
                      className="pointer-events-none absolute bg-slate-900/50 ring-2 ring-slate-900"
                      style={{
                        left: `${drawing.x * 100}%`,
                        top: `${drawing.y * 100}%`,
                        width: `${drawing.w * 100}%`,
                        height: `${drawing.h * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-slate-600">
          画错了点一下那个黑块就能删掉。
        </p>
      </div>
    </Modal>
  )
}
