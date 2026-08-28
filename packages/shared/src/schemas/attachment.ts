import { z } from 'zod'
import { ATTACHMENT_TYPE_VALUES, type AttachmentType } from '../enums.js'
import type { UserBrief } from './contract.js'

export const AttachmentUploadMetaSchema = z.object({
  attachmentType: z.enum(ATTACHMENT_TYPE_VALUES).default('ANNEX'),
})

export interface AttachmentDto {
  id: string
  contractId: string
  fileName: string
  fileSize: number
  mimeType: string
  attachmentType: AttachmentType
  /** 前端据此决定给「预览」还是只给「下载」 */
  previewable: boolean
  uploadedBy: UserBrief | null
  uploadedAt: string
}
