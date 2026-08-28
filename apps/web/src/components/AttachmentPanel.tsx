import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ALLOWED_FILE_TYPES,
  ATTACHMENT_TYPE_LABEL,
  ATTACHMENT_TYPE_VALUES,
  formatFileSize,
  type AttachmentDto,
  type AttachmentType,
} from '@contract/shared'
import { ApiError, requestBlob } from '../api/client'
import { attachmentApi } from '../api/resources'
import { ConfirmDialog, Modal, useToast } from './overlays'
import { Button, Card, EmptyState, Select, Spinner, cx } from './ui'

const ACCEPT = ALLOWED_FILE_TYPES.map((t) => t.ext).join(',')
const TYPE_HINT = [...new Set(ALLOWED_FILE_TYPES.map((t) => t.label))].join(' / ')

export function AttachmentPanel({
  contractId,
  canUpload,
  canDelete,
  onChanged,
}: {
  contractId: string
  canUpload: boolean
  canDelete: boolean
  onChanged?: () => void
}): ReactNode {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<AttachmentDto[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [type, setType] = useState<AttachmentType>('ORIGINAL')
  const [pendingDelete, setPendingDelete] = useState<AttachmentDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [preview, setPreview] = useState<{ att: AttachmentDto; url: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = (signal?: AbortSignal): Promise<void> =>
    attachmentApi
      .list(contractId, signal)
      .then((res) => setItems(res.data))
      .catch(() => {
        if (!signal?.aborted) toast.error('附件列表加载失败')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    void reload(ac.signal)
    return () => ac.abort()
  }, [contractId])

  // 预览用的 object URL 必须显式回收，否则一直占着内存
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setUploading(true)
    try {
      await attachmentApi.upload(contractId, file, type)
      toast.success(`「${file.name}」已上传`)
      await reload()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const download = async (att: AttachmentDto): Promise<void> => {
    setBusyId(att.id)
    try {
      const { blob, fileName } = await requestBlob(`/attachments/${att.id}/download`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName ?? att.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '下载失败')
    } finally {
      setBusyId(null)
    }
  }

  const openPreview = async (att: AttachmentDto): Promise<void> => {
    setBusyId(att.id)
    try {
      // 预览接口要带鉴权头，不能直接把 URL 塞给 <img>，所以先取回 blob
      const { blob } = await requestBlob(`/attachments/${att.id}/preview`)
      setPreview({ att, url: URL.createObjectURL(blob) })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '预览失败')
    } finally {
      setBusyId(null)
    }
  }

  const closePreview = (): void => {
    if (preview) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await attachmentApi.remove(pendingDelete.id)
      toast.success('附件已删除')
      setPendingDelete(null)
      await reload()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card
      title={`附件${items.length > 0 ? `（${items.length}）` : ''}`}
      bodyClassName={items.length === 0 && !canUpload ? 'p-0' : 'p-4'}
      actions={
        canUpload && (
          <div className="flex items-center gap-2">
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as AttachmentType)}
              className="w-32 py-1.5 text-[13px]"
              aria-label="附件分类"
            >
              {ATTACHMENT_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {ATTACHMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => void onPick(e.target.files?.[0])}
            />
            <Button
              size="sm"
              variant="primary"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              上传附件
            </Button>
          </div>
        )
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="text-slate-400" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="还没有附件"
          description={canUpload ? `可上传 ${TYPE_HINT}，单个文件不超过 50MB。` : undefined}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{a.fileName}</p>
                <p className="mt-0.5 text-xs text-slate-600 tabular">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    {ATTACHMENT_TYPE_LABEL[a.attachmentType]}
                  </span>
                  <span className="mx-1.5">·</span>
                  {formatFileSize(a.fileSize)}
                  <span className="mx-1.5">·</span>
                  {a.uploadedBy?.displayName ?? '未知'} 于 {a.uploadedAt.slice(0, 10)}
                </p>
              </div>
              <div className={cx('flex shrink-0 items-center gap-1', busyId === a.id && 'opacity-50')}>
                {a.previewable && (
                  <Button size="sm" variant="ghost" onClick={() => void openPreview(a)}>
                    预览
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void download(a)}>
                  下载
                </Button>
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-600 hover:bg-rose-50"
                    onClick={() => setPendingDelete(a)}
                  >
                    删除
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!preview}
        title={preview?.att.fileName ?? ''}
        onClose={closePreview}
        width="lg"
        footer={<Button onClick={closePreview}>关闭</Button>}
      >
        {preview &&
          (preview.att.mimeType === 'application/pdf' ? (
            <iframe
              src={preview.url}
              title={preview.att.fileName}
              className="h-[55vh] w-full rounded border border-slate-200"
            />
          ) : (
            <img
              src={preview.url}
              alt={preview.att.fileName}
              className="mx-auto max-h-[55vh] rounded border border-slate-200 object-contain"
            />
          ))}
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        title="删除附件"
        message={`确定删除「${pendingDelete?.fileName ?? ''}」？此操作会记入操作留痕。`}
        confirmLabel="删除"
        danger
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  )
}
