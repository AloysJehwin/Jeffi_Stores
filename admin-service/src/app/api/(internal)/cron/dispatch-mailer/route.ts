import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/shared/db'
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

  // Claimed here so an overlapping run can't pick the same one; a big audience takes minutes at the SES
  // rate, so the sends run on after this response (a failed one goes back to draft, as from Send now).
  const dispatched: string[] = []
  for (const campaign of due) {
    const claimed = await query(`UPDATE email_campaigns SET status = 'sending' WHERE id = $1 AND status = 'scheduled'`, [campaign.id])
    if (!claimed.rowCount) continue
    dispatched.push(campaign.id)
    void sendCampaign(campaign.id).catch(() =>
      query(`UPDATE email_campaigns SET status = 'draft' WHERE id = $1 AND status = 'sending'`, [campaign.id]).catch(() => {})
    )
  }

  // App pushes waiting out quiet hours (Mailer rows and scenario pushes), plus any a send left queued.
  const push = await drainCampaignPush({ budgetMs: 30_000 }).catch(e => ({ error: String(e?.message ?? e) }))
  const scenarioPush = await drainScenarioPushQueue(15_000).catch(e => ({ error: String(e?.message ?? e) }))

  return NextResponse.json({ dispatched: dispatched.length, ids: dispatched, push, scenarioPush })
}
