// Client-safe types and constants for the customer conversations feed (no server imports).

export const CONVERSATION_CHANNELS = ['chat', 'email', 'whatsapp', 'sms', 'note', 'rfq'] as const
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number]
export type ConversationDirection = 'inbound' | 'outbound' | 'internal'

export interface ConversationAttachment {
  url: string
  kind: string
  thumbnailUrl: string | null
}

export interface ConversationItem {
  id: string
  channel: ConversationChannel
  direction: ConversationDirection
  at: string
  threadId: string | null
  threadLabel: string | null
  actor: string | null
  subject: string | null
  body: string
  status: string | null
  entityType: string | null
  entityId: string | null
  attachments: ConversationAttachment[]
  href: string | null
}

export interface ConversationSummary {
  counts30d: Record<ConversationChannel, number>
  counts90d: Record<ConversationChannel, number>
  lastInboundAt: string | null
  lastOutboundAt: string | null
  openChats: number
  awaitingReply: boolean
  awaitingReplySince: string | null
  medianFirstResponseMinutes: number | null
}

export const MAX_CONVERSATION_LIMIT = 100
export const DEFAULT_CONVERSATION_LIMIT = 40

export function isConversationChannel(value: unknown): value is ConversationChannel {
  return typeof value === 'string' && (CONVERSATION_CHANNELS as readonly string[]).includes(value)
}

/** Parses a comma list; null input means every channel. Returns the offending token on failure. */
export function parseChannels(raw: string | null | undefined): { channels: ConversationChannel[] } | { error: string } {
  if (raw == null || raw.trim() === '') return { channels: [...CONVERSATION_CHANNELS] }
  const out: ConversationChannel[] = []
  for (const token of raw.split(',')) {
    const t = token.trim().toLowerCase()
    if (t === '') continue
    if (!isConversationChannel(t)) return { error: `Unknown channel: ${token.trim()}` }
    if (!out.includes(t)) out.push(t)
  }
  return out.length ? { channels: out } : { channels: [...CONVERSATION_CHANNELS] }
}

export function clampConversationLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_CONVERSATION_LIMIT
  return Math.min(MAX_CONVERSATION_LIMIT, Math.max(1, Math.trunc(n)))
}

export function emptyChannelCounts(): Record<ConversationChannel, number> {
  return { chat: 0, email: 0, whatsapp: 0, sms: 0, note: 0, rfq: 0 }
}
