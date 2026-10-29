import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getTenantOwners } from '@/lib/tenant-registry'
import { sendSupportEscalationEmail } from '@/lib/email'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { getSessionRow, updateSession, customerName, type SessionRow } from './sessions'

/**
 * Who a support escalation should reach. On a tenant host the chat belongs to that store, so it goes
 * to the store's own owner(s) only, never the platform's admins or ADMIN_EMAIL. Off-tenant (the
 * platform's own store) it goes to the platform admins plus ADMIN_EMAIL.
 */
export async function resolveEscalationRecipients(tenantId: string | null): Promise<string[]> {
  if (tenantId) {
    const owners = await getTenantOwners(tenantId).catch(() => [])
    return owners.map(o => o.email).filter((e): e is string => !!e)
  }
  const admins = await queryMany<{ email: string }>(
    `SELECT u.email FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = true AND u.email IS NOT NULL`,
    []
  )
  const emails = admins.map(a => a.email)
  const fallback = process.env.ADMIN_EMAIL
  if (fallback && !emails.includes(fallback)) emails.push(fallback)
  return emails
}

/** Move a chat from the assistant to the team: flag it, email the store, notify the panel. */
export async function handOffToHuman(sessionId: string, reason: string, summary: string | null): Promise<SessionRow | null> {
  const before = await getSessionRow(sessionId)
  if (!before || before.status !== 'open') return before
  if (before.handler === 'human' && before.handoff_at) return before

  const s = await updateSession(sessionId, { handler: 'human', handoff_reason: reason.slice(0, 300), handoff_summary: summary?.slice(0, 2000) ?? null, handoff_at: new Date().toISOString() })
  if (!s) return null
  const u = s.user_id
    ? await queryOne<{ first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>(`SELECT first_name, last_name, email, phone FROM users WHERE id = $1`, [s.user_id])
    : null
  const name = customerName({ ...u, contact_name: s.contact_name, contact_phone: s.contact_phone })

  const recipients = await resolveEscalationRecipients(s.tenant_id).catch(() => [])
  if (recipients.length) {
    await sendSupportEscalationEmail({
      customerName: name,
      customerEmail: u?.email ?? null,
      customerPhone: u?.phone ?? s.contact_phone,
      sessionId: s.id,
      ticket: s.ticket_number,
      reason,
      summary,
      channel: s.channel,
      adminEmails: recipients,
    }).catch(() => {})
  }
  createAdminNotification({
    type: 'support_escalation',
    category: 'support',
    title: `Support ${s.ticket_number ?? ''} — ${name} needs a person`.replace(/\s+/g, ' '),
    message: reason,
    link: `/admin/support?s=${s.id}`,
    entityType: 'support_session',
    entityId: s.id,
    severity: 'warning',
    scope: 'customers:read',
  }).catch(() => {})
  return s
}
