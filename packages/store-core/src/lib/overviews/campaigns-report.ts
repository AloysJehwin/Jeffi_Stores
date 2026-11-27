import { queryMany, queryOne } from '@/lib/shared/db'
import { bucketFor, previousPeriod, type Period } from '@/lib/overview/period'
import { byPeriod, groupFailures, num, periodArgs, str } from '@/lib/overviews/marketing'
import {
  BY_CAMPAIGN_SQL,
  BY_CHANNEL_SQL,
  COUNTS_SQL,
  FAILURES_SQL,
  IDLE_SQL,
  KPI_SQL,
  campaignAttention,
  seriesSql,
  toCampaignRow,
  toCampaignStats,
  toCampaignTotals,
} from '@/lib/overviews/campaigns'

// The Campaigns overview (GET /api/admin/campaigns/overview) and its export read through this.

export async function loadCampaignsOverview(period: Period) {
  const previous = previousPeriod(period)
  const bucket = bucketFor(period)
  const args = periodArgs(period, previous)
  const [kpis, series, byCampaign, byChannel, failureRows, idle, counts] = await Promise.all([
    queryMany<Record<string, unknown>>(KPI_SQL, args),
    queryMany<Record<string, unknown>>(seriesSql(bucket), args),
    queryMany<Record<string, unknown>>(BY_CAMPAIGN_SQL, args),
    queryMany<Record<string, unknown>>(BY_CHANNEL_SQL, args),
    queryMany<Record<string, unknown>>(FAILURES_SQL, args),
    queryMany<Record<string, unknown>>(IDLE_SQL, args),
    queryOne<Record<string, unknown>>(COUNTS_SQL),
  ])
  const totals = byPeriod(kpis, toCampaignTotals)
  const failedByKind = new Map<string, number>()
  for (const f of failureRows) failedByKind.set(str(f.kind), (failedByKind.get(str(f.kind)) ?? 0) + num(f.n))
  const campaigns = byCampaign.map(r => ({ ...toCampaignRow(r), failed: failedByKind.get(str(r.kind)) ?? 0 }))
  const failures = groupFailures(failureRows.map(f => ({ error: f.error, n: f.n, channel: f.channel })))
  const idleRows = idle.map(r => ({ kind: str(r.kind), name: str(r.name), last_run_at: r.last_run_at ?? null }))
  return {
    period,
    previous,
    bucket,
    current: totals.current,
    previous_totals: totals.previous,
    enabled: num(counts?.enabled),
    total_campaigns: num(counts?.total),
    series: series.map(r => ({
      label: str(r.label),
      sends: num(r.sends),
      opened: num(r.opened),
      clicked: num(r.clicked),
      converted: num(r.converted),
    })),
    campaigns,
    channels: byChannel.map(r => ({ channel: str(r.channel), ...toCampaignStats(r) })),
    failures,
    idle: idleRows,
    attention: campaignAttention(campaigns, idleRows, failures),
  }
}
