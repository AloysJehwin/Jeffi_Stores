import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/shared/db'
import { sendAuditedMail } from '@/lib/shared/mail-audit'
import { briefingFromAsync, istHour, istToday } from '@/lib/shared/daily-briefing'
import { buildOpsEmail, loadOpsEmail, opsEmailRecipients } from '@/lib/shared/ops-email'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Runs hourly; sends at the store's chosen hour (IST), or up to two hours later if that run was missed.
const CATCH_UP_HOURS = 2

async function record(date: string, sent: number, error: string | null, sections?: object) {
  await query(
    `INSERT INTO ai_briefing_log (briefing_date, recipient_count, sections, error)
     VALUES ($1::date, $2, $3::jsonb, $4)
     ON CONFLICT (briefing_date) DO UPDATE SET sent_at = NOW(), recipient_count = EXCLUDED.recipient_count,
       sections = COALESCE(EXCLUDED.sections, ai_briefing_log.sections), error = EXCLUDED.error`,
    [date, sent, sections ? JSON.stringify(sections) : null, error]
  ).catch(() => {})
}

export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  const today = istToday()
  const ctx = await loadOpsEmail()

  if (!force) {
    if (!ctx.cfg.enabled) return NextResponse.json({ skipped: true, reason: 'disabled' })
    const hour = istHour()
    if (hour < ctx.cfg.hour || hour > ctx.cfg.hour + CATCH_UP_HOURS)
      return NextResponse.json({ skipped: true, reason: 'not_the_hour', hour: ctx.cfg.hour })
    // Claim the day: nothing sent yet, and no other run busy with it (a run that died frees it after 20 min).
    const claimed = await queryOne<{ id: string }>(
      `INSERT INTO ai_briefing_log (briefing_date, recipient_count, error) VALUES ($1::date, 0, 'in_progress')
       ON CONFLICT (briefing_date) DO UPDATE SET error = 'in_progress', sent_at = NOW()
         WHERE ai_briefing_log.recipient_count = 0
           AND (ai_briefing_log.error IS DISTINCT FROM 'in_progress' OR ai_briefing_log.sent_at < NOW() - INTERVAL '20 minutes')
       RETURNING id`,
      [today]
    )
    if (!claimed) return NextResponse.json({ skipped: true, reason: 'already_sent', briefing_date: today })
  }

  let mail
  try {
    mail = await buildOpsEmail(ctx, { ai: ctx.planHas('agent:read'), attachments: true })
  } catch (err: any) {
    await record(today, 0, String(err?.message || err).slice(0, 1000))
    return NextResponse.json({ error: 'Data collection failed', detail: String(err?.message || err) }, { status: 500 })
  }

  const recipients = await opsEmailRecipients(ctx.cfg)
  if (recipients.length === 0) {
    await record(today, 0, 'no_recipients')
    return NextResponse.json({ error: 'No recipients with an email address' }, { status: 500 })
  }

  let sent = 0,
    failed = 0
  const from = await briefingFromAsync()
  for (const to of recipients) {
    try {
      await sendAuditedMail({ from, to, subject: mail.subject, html: mail.html, attachments: mail.attachments, kind: 'daily_briefing' })
      sent++
    } catch (err) {
      console.error('[daily-briefing]', err)
      failed++
    }
  }

  await record(today, sent, failed > 0 ? `${failed} send failures` : null, {
    revenue: mail.data.yesterday.revenue,
    orders: mail.data.yesterday.count,
    to_ship: mail.data.to_ship?.count ?? 0,
    stuck_shipments: mail.data.stuck_shipments.length,
    low_stock: mail.data.low_stock.length,
    attachments: mail.attachments.length,
    narration_present: !!mail.narration,
  })

  return NextResponse.json({
    success: true,
    briefing_date: today,
    recipients: recipients.length,
    sent,
    failed,
    narration_present: !!mail.narration,
  })
}
