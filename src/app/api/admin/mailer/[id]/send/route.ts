import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'
import { sendCampaign } from '@/lib/email-campaigns'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const campaign = await queryOne<{ status: string; scheduled_at: string | null }>(
    'SELECT status, scheduled_at FROM email_campaigns WHERE id = $1',
    [params.id]
  )
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (campaign.status === 'sent' || campaign.status === 'sending') {
    return NextResponse.json({ error: 'Campaign already sent or is currently sending' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const dispatchNow = body.dispatchNow === true

  if (!dispatchNow && campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date()) {
    await query(`UPDATE email_campaigns SET status = 'scheduled' WHERE id = $1`, [params.id])
    return NextResponse.json({ scheduled: true, scheduled_at: campaign.scheduled_at })
  }

  const result = await sendCampaign(params.id)
  return NextResponse.json({ sent: result.sent, failed: result.failed })
}
