import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveAudience } from '@/lib/shared/email-campaigns'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { audience_type, audience_filter } = await request.json()
  // Preview exactly what the send would resolve, so every audience option is accurate.
  const recipients = await resolveAudience(audience_type || 'all', audience_filter || {})
  return NextResponse.json({
    count: recipients.length,
    withPhone: recipients.filter(r => r.phone).length,
    recipients: recipients.map(r => ({ email: r.email, phone: r.phone, first_name: r.first_name })),
  })
}
