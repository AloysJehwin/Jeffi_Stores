import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveAudience } from '@/lib/shared/email-campaigns'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { audience_type, audience_filter, offset, limit, push } = await request.json()
  // Preview exactly what the send would resolve, so every audience option is accurate.
  const type = audience_type || 'all'
  const recipients = await resolveAudience(type, audience_filter || {})
  // Optional offset/limit return one page of recipients; counts always cover the whole audience.
  const lim = Number(limit)
  const start = Math.max(0, Number(offset) || 0)
  const page = lim > 0 ? recipients.slice(start, start + Math.min(lim, 500)) : recipients
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
    withEmail: recipients.filter(r => r.email).length,
    withPhone: recipients.filter(r => r.phone).length,
    ...(pushReach ? { push: pushReach } : {}),
    recipients: page.map(r => ({ email: r.email, phone: r.phone, first_name: r.first_name })),
  })
}
