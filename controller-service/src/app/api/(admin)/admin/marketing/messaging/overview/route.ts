import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, groupFailures, num, periodArgs, str } from '@/lib/overviews/marketing'
import {
  BROADCASTS_SQL,
  BY_CHANNEL_SQL,
  FAILURES_SQL,
  KPI_SQL,
  STATE_SQL,
  TEMPLATES_SQL,
  channelMatrix,
  messagingAttention,
  seriesSql,
  toMessagingState,
  toMessagingTotals,
} from '@/lib/overviews/marketing-messaging'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'mailer:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = periodArgs(period, previous)

  try {
    const [kpis, byChannel, failureRows, series, broadcasts, templates, state] = await Promise.all([
      queryMany<Record<string, unknown>>(KPI_SQL, args),
      queryMany<Record<string, unknown>>(BY_CHANNEL_SQL, args),
      queryMany<Record<string, unknown>>(FAILURES_SQL, args),
      queryMany<Record<string, unknown>>(seriesSql(bucket), args),
      queryMany<Record<string, unknown>>(BROADCASTS_SQL, args),
      queryMany<Record<string, unknown>>(TEMPLATES_SQL, args),
      queryOne<Record<string, unknown>>(STATE_SQL),
    ])
    const totals = byPeriod(kpis, toMessagingTotals)
    const failures = groupFailures(failureRows.map(r => ({ error: r.error, n: r.n, channel: r.channel })))
    const st = toMessagingState(state ?? undefined)
    return NextResponse.json({
      period,
      previous,
      bucket,
      current: totals.current,
      previous_totals: totals.previous,
      channels: channelMatrix(byChannel),
      failures,
      series: series.map(r => ({
        label: str(r.label),
        email: num(r.email),
        whatsapp: num(r.whatsapp),
        sms: num(r.sms),
        failed: num(r.failed),
      })),
      broadcasts: broadcasts.map(r => ({
        id: str(r.id),
        title: str(r.title),
        template:
          r.template_key === 'library'
            ? Object.values((r.channels as Record<string, { slug?: string }>) ?? {})
                .map(v => v?.slug)
                .filter(Boolean)
                .join(', ') || 'library'
            : str(r.template_key),
        sent_at: r.sent_at ?? null,
        recipients: num(r.recipient_count),
        messages: num(r.messages),
        failed: num(r.failed),
        wa_cap: num(r.wa_cap),
      })),
      templates: templates.map(r => ({
        kind: str(r.kind),
        channel: str(r.channel),
        count: num(r.n),
        failed: num(r.failed),
        spend: num(r.spend),
      })),
      state: st,
      attention: messagingAttention(totals.current, st, failures),
    })
  } catch (err) {
    console.error('[marketing/messaging/overview]', err)
    return NextResponse.json({ error: 'Failed to load messaging overview' }, { status: 500 })
  }
}
