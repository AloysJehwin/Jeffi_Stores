import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { appOptOuts, isAppAudience, pushCooldownUsers, resolveAudience, type Recipient } from '@/lib/shared/email-campaigns'
import { sesRate } from '@jeffi/mail-shell'

type Status = 'cooldown' | 'opted_out'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { audience_type, audience_filter, offset, limit, push } = await request.json()
  // Preview exactly what the send would resolve, so every audience option is accurate.
  const type = audience_type || 'all'
  const recipients = await resolveAudience(type, audience_filter || {})
  // App audiences also list signed-in customers opted out of marketing, after the recipients and
  // marked, so a known account is explained rather than missing. They are never sent to.
  const app = isAppAudience(type)
  const optedOut = app ? await appOptOuts() : []
  const listed: Array<Recipient & { status?: Status }> = [...recipients, ...optedOut.map(r => ({ ...r, status: 'opted_out' as const }))]
  // Optional offset/limit return one page; counts always cover the whole audience.
  const lim = Number(limit)
  const start = Math.max(0, Number(offset) || 0)
  const page = lim > 0 ? listed.slice(start, start + Math.min(lim, 500)) : listed
  // With a push channel, customers who already had the day's offer pushes: their push is skipped.
  let cooldown = new Set<string>()
  if (push === true) {
    const { DAILY_CAP } = await import('@/lib/push/marketing')
    cooldown = await pushCooldownUsers(page.filter(r => !r.status).map(r => r.user_id), DAILY_CAP)
  }
  // Push reach (only when the message has a push channel): app installs this audience reaches.
  let pushReach: { devices: number; people: number; signedOut: number } | undefined
  if (push === true && start === 0) {
    const { includesSignedOut, pushReach: reach } = await import('@/lib/push/broadcast')
    pushReach = await reach(
      recipients.map(r => r.user_id),
      includesSignedOut(type)
    )
  }
  return NextResponse.json({
    count: recipients.length,
    listed: listed.length,
    withEmail: recipients.filter(r => r.email).length,
    withPhone: recipients.filter(r => r.phone).length,
    // Broadcast email goes out at the bulk share of the SES rate (lib/shared/ses-pace).
    emailRate: Math.max(1, Math.floor(sesRate() * 0.75)),
    ...(pushReach ? { push: pushReach } : {}),
    ...(app ? { optedOut: optedOut.length } : {}),
    recipients: page.map(r => ({
      email: r.email,
      phone: r.phone,
      first_name: r.first_name,
      status: r.status ?? (cooldown.has(r.user_id) ? 'cooldown' : undefined),
    })),
  })
}
