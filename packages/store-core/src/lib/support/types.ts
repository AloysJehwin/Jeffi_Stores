// Client-safe support chat types, shared by the web widget, the admin inbox, the API routes and the
// mobile app's API layer (which mirrors them).

export type SupportSender = 'customer' | 'admin' | 'ai' | 'bot' | 'system'
export type SupportChannel = 'web' | 'app' | 'whatsapp' | 'email'
export type SupportHandler = 'ai' | 'human'
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
export type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'other'

/** Customer is "in the chat" while their client heartbeats within this window. */
export const PRESENCE_TTL_MS = 45_000
export const HEARTBEAT_MS = 20_000
/** WhatsApp free-form replies are allowed for 24h after the customer's last message. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000

export interface SupportAttachment {
  id: string
  kind: AttachmentKind
  mime: string
  name: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  /** Same-origin route that checks access and redirects to a short-lived signed URL. */
  url: string
  thumbUrl: string | null
}

export interface ConfirmPayload {
  type: 'confirm'
  actionId: string
  title: string
  detail?: string
  confirmLabel?: string
  status: 'pending' | 'confirmed' | 'declined' | 'done' | 'failed' | 'expired'
  resultText?: string
}

export interface OrderCardPayload {
  type: 'orders'
  orders: Array<{
    id: string
    number: string
    status: string
    paymentStatus?: string | null
    total: number
    placedAt: string
    items?: string | null
    tracking?: string | null
  }>
}

export interface ChipsPayload {
  type: 'chips'
  chips: Array<{ label: string; text: string }>
}

export interface LinkPayload {
  type: 'links'
  links: Array<{ label: string; href: string }>
}

export type SupportPayload = ConfirmPayload | OrderCardPayload | ChipsPayload | LinkPayload

export interface SupportMessage {
  id: string
  sessionId: string
  sender: SupportSender
  senderName: string | null
  /** In the viewer's language when a translation exists. */
  text: string
  /** The words as written, when `text` is a translation. */
  original: { text: string; lang: string } | null
  lang: string | null
  at: string
  status: MessageStatus
  channel: SupportChannel
  payloads: SupportPayload[]
  attachments: SupportAttachment[]
  clientId: string | null
  error?: string | null
}

export interface SupportSession {
  id: string
  ticket: string | null
  status: 'open' | 'closed'
  channel: SupportChannel
  handler: SupportHandler
  createdAt: string
  closedAt: string | null
  lastMessageAt: string | null
  customer: { id: string | null; name: string; email: string | null; phone: string | null }
  adminName: string | null
  assignedAdminId: string | null
  customerLang: string | null
  customerLastSeenAt: string | null
  adminLastSeenAt: string | null
  handoffReason: string | null
  handoffSummary: string | null
  handoffAt: string | null
  waWindowExpiresAt: string | null
  unread: number
  /** Customer replies waiting for an admin's approval. */
  approvals?: number
  lastMessage?: { sender: SupportSender; text: string; at: string } | null
}

export type SupportEvent =
  | { kind: 'message'; sessionId: string; message: SupportMessage; translations?: Record<string, string> }
  | { kind: 'translation'; sessionId: string; id: string; translations: Record<string, string> }
  | { kind: 'message_update'; sessionId: string; id: string; status?: MessageStatus; deliveredAt?: string | null; readAt?: string | null; payloads?: SupportPayload[]; error?: string | null }
  | { kind: 'receipts'; sessionId: string; side: 'customer' | 'admin'; state: 'delivered' | 'read'; upTo: string; at: string }
  | { kind: 'typing'; sessionId: string; who: 'customer' | 'admin' | 'ai'; name?: string | null; on: boolean }
  | { kind: 'presence'; sessionId: string; side: 'customer' | 'admin'; lastSeenAt: string; active: boolean }
  | { kind: 'session'; sessionId: string; session: Partial<SupportSession> & { id: string } }

export function isActive(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  return !!lastSeenAt && now - new Date(lastSeenAt).getTime() < PRESENCE_TTL_MS
}

export const SUPPORT_LANGUAGES: Array<{ code: string; label: string; native: string }> = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur', label: 'Urdu', native: 'اردو' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
]

export const isSupportLanguage = (code: unknown): code is string =>
  typeof code === 'string' && SUPPORT_LANGUAGES.some(l => l.code === code)

export const languageLabel = (code: string | null | undefined) =>
  SUPPORT_LANGUAGES.find(l => l.code === code)?.label ?? code ?? ''
