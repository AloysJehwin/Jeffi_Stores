'use client'

import Link from 'next/link'
import { Badge, Banner, Kpi, KpiGrid, Section, Table, count, money, type Col, type Tone } from '@/components/admin/channels/ui'
import { useOverviewData } from '@/components/admin/overview/kit'
import { MarketplaceSettlementsTabSkeleton } from './FinanceSkeletons'
import { ap } from '@/lib/shared/admin-path'
import type { ChannelSummary, MarketplaceSettlementsOverview, RecentSettlement, SettlementChannel } from '@/lib/marketplace/settlements'
import { FinancePeriodBar, useFinancePeriod } from './finance'

const PATH: Record<SettlementChannel, string> = { myntra: '/admin/myntra?tab=settlements', ajio: '/admin/ajio?tab=settlements', amazon: '/admin/amazon' }
const TONE: Record<SettlementChannel, Tone> = { myntra: 'red', ajio: 'blue', amazon: 'amber' }
const LABEL: Record<SettlementChannel, string> = { myntra: 'Myntra', ajio: 'AJIO', amazon: 'Amazon' }

const fmtDate = (v: string | null) => (v ? new Date(`${v}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')

const CHANNEL_COLS: Col<ChannelSummary>[] = [
  {
    key: 'channel',
    label: 'Marketplace',
    render: r => (
      <Link href={ap(PATH[r.channel])} className="font-medium text-accent-600 hover:underline">
        {r.label}
      </Link>
    ),
  },
  { key: 'count', label: 'Payouts', num: true, render: r => count(r.count), sort: r => r.count },
  { key: 'gross', label: 'Sales', num: true, render: r => money(r.gross), sort: r => r.gross },
  { key: 'charges', label: 'Commission + fees', num: true, render: r => money(r.charges), sort: r => r.charges },
  { key: 'tax', label: 'TCS / TDS', num: true, render: r => money(r.tax), sort: r => r.tax },
  { key: 'refunds', label: 'Refunds', num: true, render: r => money(r.refunds), sort: r => r.refunds },
  { key: 'net', label: 'Settled', num: true, render: r => <span className="font-medium">{money(r.net)}</span>, sort: r => r.net },
  {
    key: 'receivable',
    label: 'Receivable',
    num: true,
    render: r =>
      r.receivable ? (
        <span title={`${count(r.receivable.unsettledOrders)} delivered order(s) with nothing settled`}>
          {money(r.receivable.unsettledValue)}
          {r.receivable.overdueOrders > 0 && (
            <span className="ml-1.5">
              <Badge tone="red">{count(r.receivable.overdueOrders)} overdue</Badge>
            </span>
          )}
        </span>
      ) : (
        <span className="text-foreground-muted">-</span>
      ),
    sort: r => r.receivable?.unsettledValue ?? -1,
  },
  { key: 'last', label: 'Last settled', render: r => fmtDate(r.lastSettledOn), sort: r => r.lastSettledOn ?? '' },
]

const RECENT_COLS: Col<RecentSettlement>[] = [
  { key: 'date', label: 'Settled', render: r => fmtDate(r.settled_on), sort: r => r.settled_on ?? '' },
  { key: 'channel', label: 'Marketplace', render: r => <Badge tone={TONE[r.channel]}>{LABEL[r.channel]}</Badge> },
  { key: 'ref', label: 'Reference', render: r => <span className="font-mono text-xs">{r.ref}</span> },
  { key: 'gross', label: 'Sales', num: true, render: r => money(r.gross), sort: r => r.gross },
  { key: 'charges', label: 'Charges', num: true, render: r => money(r.charges), sort: r => r.charges },
  { key: 'net', label: 'Settled', num: true, render: r => money(r.net), sort: r => r.net },
]

/** Myntra and AJIO payouts with what is still receivable, and Amazon's settlements (read-only). */
export function MarketplaceSettlementsTab() {
  const { range } = useFinancePeriod()
  const { data: d, error, loading, reload } = useOverviewData<MarketplaceSettlementsOverview>(`/api/admin/financial/marketplace-settlements?from=${range.from}&to=${range.to}`)
  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !d ? (
        <MarketplaceSettlementsTabSkeleton />
      ) : (
        d && (
          <>
            <KpiGrid>
              <Kpi label="Settled to bank" value={money(d.totals.net)} sub="Myntra, AJIO and Amazon in this period" highlight />
              <Kpi label="Commission + fees" value={money(d.totals.charges)} />
              <Kpi label="Receivable" value={money(d.totals.receivable)} sub="Delivered Myntra and AJIO orders with nothing settled" />
              <Kpi label="Overdue" value={count(d.totals.overdue)} sub="Unsettled 20+ days after delivery" />
            </KpiGrid>
            <Section title="By marketplace">
              <Table rows={d.channels} cols={CHANNEL_COLS} rowKey={r => r.channel} />
              <p className="mt-3 text-xs text-foreground-muted">
                Myntra and AJIO payouts come from the settlement reports imported on their Settlements tabs. Amazon settlements are read by the Amazon reports job and shown here as they are.
              </p>
            </Section>
            <Section title="Payouts">
              <Table rows={d.recent} cols={RECENT_COLS} rowKey={r => `${r.channel}:${r.ref}`} empty="No marketplace payouts in this period." />
            </Section>
          </>
        )
      )}
    </div>
  )
}
