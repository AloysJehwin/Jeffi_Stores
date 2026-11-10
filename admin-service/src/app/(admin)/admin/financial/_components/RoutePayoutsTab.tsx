'use client'

import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import { useOverviewData } from '@/components/admin/overview/kit'
import { RoutePayoutsTabSkeleton } from './FinanceSkeletons'
import { badgeCls } from '@/components/admin/kit'
import type { RouteOverview, RoutePayoutRow, RoutePendingRow } from '@/lib/payments/rzp-route-report'
import RazorpayAccountCard from '@/components/admin/RazorpayAccountCard'
import { FinancePeriodBar, useFinancePeriod } from './finance'

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-'

const STAGE: Record<RoutePendingRow['stage'], { label: string; tone: 'amber' | 'blue' | 'red' }> = {
  awaiting: { label: 'Awaiting transfer', tone: 'amber' },
  on_hold: { label: 'Held until payout', tone: 'blue' },
  failed: { label: 'Transfer failed', tone: 'red' },
}

/** A store paid through the platform's Razorpay: its sales, its share, and payouts to its bank. */
export function RoutePayoutsTab({ ownPending = false }: { ownPending?: boolean }) {
  const { range } = useFinancePeriod()
  const { data, error, loading, reload } = useOverviewData<RouteOverview>(`/api/admin/financial/route-payouts?from=${range.from}&to=${range.to}`)
  return (
    <div className="space-y-5">
      <RazorpayAccountCard />
      {ownPending && (
        <Banner ok={false}>Your own Razorpay keys aren&apos;t saved yet, so payments still go through the platform account and are paid out below.</Banner>
      )}
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <RoutePayoutsTabSkeleton /> : data && <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: RouteOverview }) {
  const t = d.totals
  const due = d.pending.awaitingTransfer + d.pending.onHold
  return (
    <div className="space-y-5">
      {!d.payoutTarget.linked && (
        <Banner ok={false}>No bank account is linked for payouts yet. Your share waits with the platform until you add one in your Ecom portal.</Banner>
      )}
      <KpiGrid>
        <Kpi label="Online sales" value={money(t.gross)} sub={`${count(t.payments)} payments`} />
        <Kpi label="Platform commission" value={money(t.commission)} />
        <Kpi label="Gateway fees" value={money(t.fees)} sub="Razorpay, incl. GST" />
        <Kpi label="Your share" value={money(t.share)} sub={t.refunded ? `${money(t.refunded)} refunded` : undefined} />
        <Kpi label="Paid to your bank" value={money(d.paidOut.amount)} sub={`${count(d.paidOut.count)} payouts`} highlight />
        <Kpi
          label="Not paid out yet"
          value={money(due)}
          sub={d.payoutTarget.dailyPayout ? 'Paid out daily' : 'Paid out weekly'}
        />
      </KpiGrid>

      <Section title="Payouts to your bank">
        <Table rows={d.payouts} cols={PAYOUT_COLS} rowKey={r => r.id} empty="No payouts in this period." />
      </Section>

      <Section title={`Not paid out yet${d.pending.failed ? ` · ${count(d.pending.failed)} failed` : ''}`}>
        <Table rows={d.pendingRows} cols={PENDING_COLS} rowKey={r => r.id} empty="Every payment's share has been paid out." />
      </Section>
    </div>
  )
}

const PAYOUT_COLS: Col<RoutePayoutRow>[] = [
  { key: 'at', label: 'Paid out', sort: r => r.settled_at ?? '', render: r => fmtDate(r.settled_at) },
  { key: 'id', label: 'Payout', render: r => <span className="font-mono text-xs">{r.id}</span> },
  { key: 'utr', label: 'UTR', render: r => <span className="font-mono text-xs">{r.utr || '-'}</span> },
  { key: 'amount', label: 'To bank', num: true, sort: r => r.amount, render: r => money(r.amount) },
  { key: 'fees', label: 'Fees + GST', num: true, render: r => money(r.fees) },
  { key: 'payments', label: 'Payments', num: true, render: r => count(r.payments) },
]

const PENDING_COLS: Col<RoutePendingRow>[] = [
  { key: 'at', label: 'Paid', sort: r => r.occurred_at, render: r => fmtDate(r.occurred_at) },
  { key: 'order', label: 'Order', render: r => <span className="font-mono text-xs">{r.order_ref || '-'}</span> },
  { key: 'gross', label: 'Payment', num: true, sort: r => r.gross, render: r => money(r.gross) },
  { key: 'share', label: 'Your share', num: true, sort: r => r.share, render: r => money(r.share) },
  {
    key: 'stage',
    label: 'Status',
    render: r => (
      <span className={badgeCls(STAGE[r.stage].tone)} title={r.failure_reason ?? undefined}>
        {STAGE[r.stage].label}
      </span>
    ),
  },
]
