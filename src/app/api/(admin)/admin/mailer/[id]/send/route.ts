import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'

const BATCH_SIZE = 50 // emails per batch
const BATCH_DELAY = 1000 // ms between batches — stays under SES rate limits

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'mailer:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const campaign = await queryOne<{ status: string; scheduled_at: string | null }>(
    'SELECT status, scheduled_at FROM email_campaigns WHERE id = $1',
    [id]
  )
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (campaign.status === 'sent' || campaign.status === 'sending') {
    return NextResponse.json({ error: 'Campaign already sent or is currently sending' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const dispatchNow = body.dispatchNow === true
  // DateTimePicker returns naive local time (IST) — append offset so Postgres stores correct UTC
  const rawScheduled = body.scheduled_at as string | undefined
  const scheduledAt = rawScheduled
    ? rawScheduled.includes('+') || rawScheduled.endsWith('Z')
      ? rawScheduled
      : `${rawScheduled}:00+05:30`
    : undefined

  // If a scheduled_at was passed in the body, persist it and mark scheduled
  if (!dispatchNow && scheduledAt) {
    const schedDate = new Date(scheduledAt)
    if (schedDate > new Date()) {
      await query(`UPDATE email_campaigns SET status = 'scheduled', scheduled_at = $1 WHERE id = $2`, [scheduledAt, id])
      return NextResponse.json({ scheduled: true, scheduled_at: scheduledAt })
    }
  }

  // If already scheduled (from DB) and not dispatchNow, just confirm
  if (!dispatchNow && campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date()) {
    await query(`UPDATE email_campaigns SET status = 'scheduled' WHERE id = $1`, [id])
    return NextResponse.json({ scheduled: true, scheduled_at: campaign.scheduled_at })
  }

  // Mark as queued immediately — return fast to the client
  await query(`UPDATE email_campaigns SET status = 'sending' WHERE id = $1`, [id])

  // Fire-and-forget background send (does NOT block the response)
  sendInBackground(id, BATCH_SIZE, BATCH_DELAY).catch(() => {
    query(`UPDATE email_campaigns SET status = 'draft' WHERE id = $1`, [id]).catch(() => {})
  })

  return NextResponse.json({ queued: true, batch_size: BATCH_SIZE })
}

// Background send — runs after the HTTP response is already returned
async function sendInBackground(campaignId: string, batchSize: number, batchDelay: number) {
  const { sendCampaign } = await import('@/lib/shared/email-campaigns')
  await sendCampaign(campaignId, { batchSize, batchDelay })
}
