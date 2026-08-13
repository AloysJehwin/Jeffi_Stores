import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { sendCampaign } from '@/lib/email-campaigns'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find scheduled email_campaigns whose time has come
  const due = await queryMany<{ id: string; title: string }>(
    `SELECT id, title FROM email_campaigns
     WHERE status = 'scheduled' AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT 5`
  )

  if (!due.length) return NextResponse.json({ dispatched: 0 })

  const dispatched: string[] = []
  for (const campaign of due) {
    try {
      await sendCampaign(campaign.id, { batchSize: 50, batchDelay: 1000 })
      dispatched.push(campaign.id)
    } catch {
      // Logged inside sendCampaign — continue to next
    }
  }

  return NextResponse.json({ dispatched: dispatched.length, ids: dispatched })
}
