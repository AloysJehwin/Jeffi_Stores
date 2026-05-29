import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import { type CampaignKind } from '@/lib/marketing'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { kind: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { email } = await req.json()
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const result = await sendTestCampaignEmail(params.kind as CampaignKind, email)
  if (!result.ok) {
    return NextResponse.json({ error: result.reason || 'Failed to send' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
