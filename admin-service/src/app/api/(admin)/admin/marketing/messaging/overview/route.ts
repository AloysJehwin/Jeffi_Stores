import { NextRequest, NextResponse } from 'next/server'
import { filterScope, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, parsePeriod, previousPeriod } from '@/lib/overview/period'
import { byPeriod, groupFailures, num, periodArgs, str } from '@/lib/overviews/marketing'
import {
  channelMatrix,
  messagingAttention,
  messagingSql,
  stateSql,
  toMessagingState,
  toMessagingTotals,
} from '@/lib/overviews/marketing-messaging'
import { MESSAGING_ENTITY } from '@/lib/filters/entities/messaging'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'mailer:read')
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const period = parsePeriod(sp.get('from'), sp.get('to'))
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  // The broadcast list's filters, except its date (the period owns from / to); with any on, only
  // the matching broadcasts count.
  const scope = filterScope(MESSAGING_ENTITY, normalizeQuery(MESSAGING_ENTITY, sp), { omit: ['sent'] })
  const ids = (col: string) => scope.inIds(col, 4)
  const SQL = scope.empty ? messagingSql() : messagingSql(col => ids(col).sql, ' AND FALSE')
  const base = periodArgs(period, previous)
  const args = [...base, ...ids('c.id').params]
  const state = scope.and(1)

  try {
    const [kpis, byChannel, failureRows, series, broadcasts, templates, stateRow] = await Promise.all([
      queryMany<Record<string, unknown>>(SQL.kpis, args),
      queryMany<Record<string, unknown>>(SQL.byChannel, args),
      queryMany<Record<string, unknown>>(SQL.failures, args),
      queryMany<Record<string, unknown>>(SQL.series(bucket), args),
      queryMany<Record<string, unknown>>(SQL.broadcasts, args),
      // Automated sends only: no broadcast filter to bind.
      queryMany<Record<string, unknown>>(SQL.templates, base),
      scope.empty ? queryOne<Record<string, unknown>>(stateSql()) : queryOne<Record<string, unknown>>(stateSql(state.sql), state.params),
    ])
    const totals = byPeriod(kpis, toMessagingTotals)
    const failures = groupFailures(failureRows.map(r => ({ error: r.error, n: r.n, channel: r.channel })))
    const st = toMessagingState(stateRow ?? undefined)
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
        push: num(r.push),
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
      filtered: !scope.empty,
    })
  } catch (err) {
    console.error('[marketing/messaging/overview]', err)
    return NextResponse.json({ error: 'Failed to load messaging overview' }, { status: 500 })
  }
}
