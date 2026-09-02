import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryMany } from '@/lib/db'
import { sendAuditedMail } from '@/lib/mail-audit'
import {
  collectBriefingData,
  narrate,
  renderBriefingEmail,
  briefingFromAsync,
} from '@/lib/daily-briefing'

export const dynamic = 'force-dynamic'

interface AdminRecipient {
  email: string | null
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  const today = new Date().toISOString().slice(0, 10)

  if (!force) {
    const sentToday = await queryOne<{ id: string }>(
      `SELECT id FROM ai_briefing_log WHERE briefing_date = $1::date AND error IS NULL`,
      [today]
    )
    if (sentToday) {
      return NextResponse.json({ skipped: true, reason: 'already_sent', briefing_date: today })
    }
  }

  let data
  try {
    data = await collectBriefingData()
  } catch (err: any) {
    await query(
      `INSERT INTO ai_briefing_log (briefing_date, recipient_count, error)
       VALUES ($1::date, 0, $2)
       ON CONFLICT (briefing_date) DO UPDATE SET error = EXCLUDED.error, sent_at = NOW()`,
      [today, String(err?.message || err).slice(0, 1000)]
    ).catch(() => {})
    return NextResponse.json({ error: 'Data collection failed', detail: String(err?.message || err) }, { status: 500 })
  }

  const narration = await narrate(data)
  const { subject, html } = renderBriefingEmail(data, narration)

  const admins = await queryMany<AdminRecipient>(
    `SELECT u.email
     FROM admins a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.is_active = TRUE AND u.email IS NOT NULL`,
    []
  )

  const recipients = admins.map(a => a.email).filter((e): e is string => !!e && e.includes('@'))
  if (recipients.length === 0) {
    await query(
      `INSERT INTO ai_briefing_log (briefing_date, recipient_count, error)
       VALUES ($1::date, 0, $2)
       ON CONFLICT (briefing_date) DO UPDATE SET error = EXCLUDED.error, sent_at = NOW()`,
      [today, 'no_active_admins']
    ).catch(() => {})
    return NextResponse.json({ error: 'No active admins with email' }, { status: 500 })
  }

  let sent = 0, failed = 0
  const briefingFrom = await briefingFromAsync()
  for (const to of recipients) {
    try {
      await sendAuditedMail({ from: briefingFrom, to, subject, html, kind: 'daily_briefing' })
      sent++
    } catch (err) {
      console.error('[route]', err)
      failed++
    }
  }

  await query(
    `INSERT INTO ai_briefing_log (briefing_date, recipient_count, sections, error)
     VALUES ($1::date, $2, $3::jsonb, $4)
     ON CONFLICT (briefing_date)
     DO UPDATE SET sent_at = NOW(), recipient_count = EXCLUDED.recipient_count,
                   sections = EXCLUDED.sections, error = EXCLUDED.error`,
    [
      today,
      sent,
      JSON.stringify({
        revenue: data.yesterday.revenue,
        orders: data.yesterday.count,
        stuck_shipments: data.stuck_shipments.length,
        low_stock: data.low_stock.length,
        narration_present: !!narration,
      }),
      failed > 0 ? `${failed} send failures` : null,
    ]
  ).catch(() => {})

  return NextResponse.json({
    success: true,
    briefing_date: today,
    recipients: recipients.length,
    sent,
    failed,
    narration_present: !!narration,
  })
}
