import type {
  AttachmentDto,
  AttachmentType,
  AuditLogDto,
  AuthenticatedUser,
  ExtractionResult,
  ExtractionStatus,
  PagePreview,
  RedactionRect,
  ContractDetail,
  ContractListItem,
  ContractType,
  LoginResult,
  UserBrief,
} from '@contract/shared'
import { clearSession, getSession, request, saveSession, type ApiResult } from './client'

/* ── 认证 ──────────────────────────────────────────────────────────── */

export const authApi = {
  async login(username: string, password: string): Promise<AuthenticatedUser> {
    const { data } = await request<LoginResult>('/auth/login', {
      method: 'POST',
      body: { username, password },
      anonymous: true,
    })
    await saveSession(data)
    return data.user
  },

  async logout(): Promise<void> {
    const session = await getSession()
    if (session) {
      await request('/auth/logout', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      }).catch(() => {
        /* 服务端作废失败也要把本地清掉 */
      })
    }
    await clearSession()
  },

  me: () => request<AuthenticatedUser>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
}

/* ── 合同 ──────────────────────────────────────────────────────────── */

export const contractApi = {
  list: (query: string, signal?: AbortSignal): Promise<ApiResult<ContractListItem[]>> =>
    request<ContractListItem[]>(`/contracts${query ? `?${query}` : ''}`, { signal }),

  detail: (id: string, signal?: AbortSignal) =>
    request<ContractDetail>(`/contracts/${id}`, { signal }),

  create: (body: unknown) => request<ContractDetail>('/contracts', { method: 'POST', body }),

  update: (id: string, body: unknown) =>
    request<ContractDetail>(`/contracts/${id}`, { method: 'PATCH', body }),

  remove: (id: string) => request(`/contracts/${id}`, { method: 'DELETE' }),

  changeStatus: (id: string, body: unknown) =>
    request<ContractDetail>(`/contracts/${id}/status`, { method: 'POST', body }),

  nextNo: (contractType: ContractType) =>
    request<{ contractNo: string }>(`/contracts/next-no?contractType=${contractType}`),

  auditLogs: (id: string, signal?: AbortSignal) =>
    request<AuditLogDto[]>(`/contracts/${id}/audit-logs?pageSize=100`, { signal }),
}

/* ── 附件 ──────────────────────────────────────────────────────────── */

export const attachmentApi = {
  list: (contractId: string, signal?: AbortSignal) =>
    request<AttachmentDto[]>(`/contracts/${contractId}/attachments`, { signal }),

  upload: (contractId: string, file: File, attachmentType: AttachmentType) => {
    const fd = new FormData()
    fd.append('attachmentType', attachmentType)
    fd.append('file', file, file.name)
    return request<AttachmentDto>(`/contracts/${contractId}/attachments`, {
      method: 'POST',
      formData: fd,
    })
  },

  remove: (id: string) => request(`/attachments/${id}`, { method: 'DELETE' }),
}

/* ── 内容识别 ───────────────────────────────────────────────────────── */

export const extractionApi = {
  /** 没配 key 时返回 available:false，前端据此隐藏识别入口 */
  status: (signal?: AbortSignal) =>
    request<ExtractionStatus & { supportedMimes: string[]; maxPages: number }>(
      '/extraction/status',
      { signal },
    ),

  /** 渲染每页预览图，给涂抹界面当画布。纯本地渲染，不出网。 */
  preview: (file: File, signal?: AbortSignal) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    return request<PagePreview[]>('/extraction/preview', {
      method: 'POST',
      formData: fd,
      signal,
    })
  },

  extract: (file: File, redactions: RedactionRect[], signal?: AbortSignal) => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    // 涂抹区跟文件一起发。服务端用 req.parts() 遍历，跟顺序无关。
    if (redactions.length > 0) fd.append('redactions', JSON.stringify(redactions))
    return request<ExtractionResult>('/extraction/contract', {
      method: 'POST',
      formData: fd,
      signal,
    })
  },
}

/* ── 用户 ──────────────────────────────────────────────────────────── */

export const userApi = {
  list: (signal?: AbortSignal) => request<UserBrief[]>('/users', { signal }),
}
