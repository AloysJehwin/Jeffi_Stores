// Client-safe types and constants for customer notes (no server imports).

export const NOTE_TAGS = ['measurement', 'custom-order', 'complaint', 'follow-up', 'delivery', 'payment', 'other'] as const
export type NoteTag = (typeof NOTE_TAGS)[number]
export type NoteSource = 'admin_panel' | 'staff_form'

export interface NoteAttachment {
  id: string
  kind: 'image' | 'audio'
  url: string
  thumbnailUrl: string | null
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  durationSeconds: number | null
  originalName: string | null
}

export interface CustomerNote {
  id: string
  userId: string
  body: string
  title: string | null
  tags: string[]
  orderId: string | null
  orderNumber: string | null
  returnRequestId: string | null
  sharedWithCustomer: boolean
  source: NoteSource
  createdAt: string
  adminId: string | null
  adminUsername: string | null
  attachments: NoteAttachment[]
}
