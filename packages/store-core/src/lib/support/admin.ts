import 'server-only'
import { queryMany } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { fileLevel, atLeast, type DriveActor } from '@/lib/drive/access'
import { getSessionRow, updateSession, closeSession, type SessionRow } from './sessions'
import { postMessage, type AttachmentInput } from './messages'
import { notifyCustomerIfAway } from './notify'
import { translateOne } from './translate'
import { afterResponse, runSupportTurn } from './agent'
import type { AttachmentKind, SupportMessage } from './types'

// What an agent does in a chat: join (taking it from the assistant), reply (translated to the
// customer's language), hand back to the assistant, close.

export interface AgentRef {
  adminId: string
  name: string
  lang: string
}

/** Take the chat: it leaves the assistant, and the customer is told (by email if they're away). */
export async function joinChat(s: SessionRow, agent: AgentRef): Promise<SessionRow> {
  if (s.handler === 'human' && s.assigned_admin_id === agent.adminId) return s
  const next = (await updateSession(s.id, { handler: 'human', assigned_admin_id: agent.adminId, admin_name: agent.name })) ?? s
  await postMessage({ session: next, sender: 'system', text: `${agent.name} joined the chat`, lang: 'en' })
  await notifyCustomerIfAway(s.id, { joined: true, agentName: agent.name, preview: null }).catch(() => false)
  if (s.user_id) {
    logActivity({ userId: s.user_id, actorId: agent.adminId, kind: 'support_message', referenceId: s.id, referenceType: 'support_sessions', summary: `${agent.name} joined the support chat`, metadata: { from: 'admin' } }).catch(() => {})
  }
  return next
}

export async function handBackToAi(s: SessionRow, agent: AgentRef): Promise<SessionRow> {
  const next = (await updateSession(s.id, { handler: 'ai', assigned_admin_id: null, handoff_reason: null, handoff_summary: null, handoff_at: null })) ?? s
  await postMessage({ session: next, sender: 'system', text: `${agent.name} handed the chat back to the assistant`, lang: 'en' })
  await afterResponse(() => runSupportTurn(s.id))
  return next
}

export async function closeChat(s: SessionRow, agent: AgentRef): Promise<boolean> {
  const closed = await closeSession(s.id)
  if (!closed) return false
  await postMessage({ session: closed, sender: 'system', text: `${agent.name} closed the chat`, lang: 'en', inbound: true })
  if (s.user_id) {
    logActivity({ userId: s.user_id, actorId: agent.adminId, kind: 'support_message', referenceId: s.id, referenceType: 'support_sessions', summary: 'Agent closed the support chat', metadata: { from: 'admin' } }).catch(() => {})
  }
  return true
}

/** Drive files an agent attaches: ones they uploaded for this chat, or any Drive file they can view. */
export async function agentAttachments(actor: DriveActor, ids: string[]): Promise<AttachmentInput[] | null> {
  if (!ids.length) return []
  const rows = await queryMany<any>(
    `SELECT id, folder_id, uploaded_by_admin_id, kind, mime_type, name, size_bytes, width, height, duration_seconds
       FROM drive_files WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [ids]
  )
  if (rows.length !== ids.length) return null
  for (const r of rows) {
    if (r.uploaded_by_admin_id === actor.adminId) continue
    if (!atLeast(await fileLevel(actor, r), 'view')) return null
  }
  const order = new Map(ids.map((id, i) => [id, i]))
  return rows
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map(f => ({
      driveFileId: f.id,
      kind: f.kind as AttachmentKind,
      mime: f.mime_type,
      name: f.name,
      size: Number(f.size_bytes),
      width: f.width,
      height: f.height,
      duration: f.duration_seconds != null ? Number(f.duration_seconds) : null,
    }))
}

/** An agent's reply. Joins the chat first if the assistant (or another agent) had it. */
export async function agentReply(
  s: SessionRow,
  agent: AgentRef,
  input: { text: string; clientId?: string | null; attachments: AttachmentInput[] }
): Promise<SupportMessage> {
  let session = s
  if (s.handler !== 'human' || !s.assigned_admin_id) session = await joinChat(s, agent)
  const target = session.customer_lang
  const translations: Record<string, string> = {}
  if (input.text && target && target !== agent.lang) {
    const t = await translateOne(input.text, target, agent.lang)
    if (t) translations[target] = t
  }
  const m = await postMessage({
    session: (await getSessionRow(session.id)) ?? session,
    sender: 'admin',
    adminId: agent.adminId,
    text: input.text,
    clientId: input.clientId ?? null,
    attachments: input.attachments,
    lang: agent.lang,
    translations,
  })
  if (s.user_id) {
    const preview = input.text.length > 100 ? `${input.text.slice(0, 100)}…` : input.text || `${input.attachments.length} attachment(s)`
    logActivity({ userId: s.user_id, actorId: agent.adminId, kind: 'support_message', referenceId: s.id, referenceType: 'support_sessions', summary: `Agent replied: ${preview}`, metadata: { from: 'admin' } }).catch(() => {})
  }
  return m
}
