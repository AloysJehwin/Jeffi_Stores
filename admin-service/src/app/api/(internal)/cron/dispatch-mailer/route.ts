import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { sendCampaign } from '@/lib/shared/email-campaigns'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { drainCampaignPush } from '@/lib/push/broadcast'
import { drainScenarioPushQueue } from '@/lib/campaigns/push-dispatch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find scheduled email_campaigns whose time has come
  const due = await queryMany<{ id: string; title: string }>(
    `SELECT id, title FROM email_campaigns
     WHERE status = 'scheduled' AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT 5`
  )

  const dispatched: string[] = []
  for (const campaign of due) {
    try {
      await sendCampaign(campaign.id, { batchSize: 50, batchDelay: 1000 })
      dispatched.push(campaign.id)
    } catch {
      // Logged inside sendCampaign — continue to next
    }
  }

  // App pushes waiting out quiet hours (Mailer rows and scenario pushes), plus any a send left queued.
  const push = await drainCampaignPush({ budgetMs: 30_000 }).catch(e => ({ error: String(e?.message ?? e) }))
  const scenarioPush = await drainScenarioPushQueue(15_000).catch(e => ({ error: String(e?.message ?? e) }))

  return NextResponse.json({ dispatched: dispatched.length, ids: dispatched, push, scenarioPush })
}
