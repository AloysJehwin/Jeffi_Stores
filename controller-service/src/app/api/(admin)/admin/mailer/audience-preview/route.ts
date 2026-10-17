import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveAudience } from '@/lib/shared/email-campaigns'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { audience_type, audience_filter, offset, limit } = await request.json()
  // Preview exactly what the send would resolve, so every audience option is accurate.
  const recipients = await resolveAudience(audience_type || 'all', audience_filter || {})
  // Optional offset/limit return one page of recipients; counts always cover the whole audience.
  const lim = Number(limit)
  const start = Math.max(0, Number(offset) || 0)
  const page = lim > 0 ? recipients.slice(start, start + Math.min(lim, 500)) : recipients
  return NextResponse.json({
    count: recipients.length,
    withPhone: recipients.filter(r => r.phone).length,
    recipients: page.map(r => ({ email: r.email, phone: r.phone, first_name: r.first_name })),
  })
}
