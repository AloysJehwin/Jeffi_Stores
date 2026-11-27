import { createHash } from 'node:crypto'
import { createAutoTask, type AutoTaskKind, type Priority } from '@/lib/shared/auto-tasks'

// The tasks the team sees (Admin > Tasks) and the support tickets the agent opens. Task source_kind is free text in the
// DB; the admin task list files an unknown kind under "manual".
const AGENT_TASK = 'outreach_agent' as AutoTaskKind

export const STAFF_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

/** One pending task per (key): a repeat of the same request while it is open is a no-op (returns null). */
export async function createStaffTask(p: {
  userId: string | null
  key: string
  title: string
  description?: string
  priority?: Priority
  dueInDays?: number
}): Promise<string | null> {
  if (!p.userId) return null
  return createAutoTask({
    userId: p.userId,
    sourceKind: AGENT_TASK,
    sourceRefId: p.key.length > 120 ? createHash('sha1').update(p.key).digest('hex') : p.key,
    title: p.title,
    description: p.description,
    priority: p.priority ?? 'medium',
    dueInDays: p.dueInDays ?? 1,
  })
}

export interface TicketResult {
  ticket: string | null
  sessionId: string
  alreadyOpen: boolean
}

/**
 * A support ticket for the team: the customer's open chat (or a new WhatsApp one) handed to a person with the summary.
 * Escalation email and the admin notification come from handOffToHuman.
 */
export async function openSupportTicket(p: {
  userId: string | null
  phone: string
  name: string | null
  summary: string
  reason: string
}): Promise<TicketResult> {
  const { createSession, openSessionFor, openContactSession } = await import('@/lib/support/sessions')
  const { handOffToHuman } = await import('@/lib/support/handoff')
  const { phone10 } = await import('@/lib/orders/by-phone')
  const existing = p.userId ? await openSessionFor(p.userId) : await openContactSession(phone10(p.phone))
  const session =
    existing ??
    (await createSession({ userId: p.userId, channel: 'whatsapp', handler: 'human', contactPhone: p.phone, contactName: p.name?.slice(0, 120) || null, waAudience: 'customer' }))
  const alreadyHandedOff = !!existing && existing.handler === 'human' && !!existing.handoff_at
  const handed = await handOffToHuman(session.id, p.reason, p.summary)
  return { ticket: (handed ?? session).ticket_number, sessionId: session.id, alreadyOpen: alreadyHandedOff }
}
