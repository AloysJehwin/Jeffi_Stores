'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { badgeCls, useActionToast } from '@/components/admin/kit'
import type { AwaitingRow, AwaitingSettlement, SettlementDetail, SettlementLine, SettlementOverview, SettlementRow } from '@/lib/payments/rzp-settlement-report'
import { FinancePeriodBar, useFinancePeriod } from './finance'
import { tableWrapCls, theadCls, thCls, thRight } from './shared'

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-'
const fmtTime = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '-'

const TYPE_LABEL: Record<string, string> = { payment: 'Payment', refund: 'Refund', transfer: 'Transfer to store', adjustment: 'Adjustment', dispute: 'Dispute', reversal: 'Reversal' }

export function RazorpaySettlementsTab() {
  const { range } = useFinancePeriod()
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()
  const [syncing, setSyncing] = useState(false)
  const overview = useOverviewData<SettlementOverview>(`/api/admin/financial/razorpay-settlements?from=${range.from}&to=${range.to}`)
  const awaiting = useOverviewData<AwaitingSettlement>('/api/admin/financial/razorpay-settlements/awaiting')

  async function sync() {
    setSyncing(true)
    const res = await fetch('/api/admin/financial/razorpay-settlements/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const j = await res.json().catch(() => ({}))
    setSyncing(false)
    if (!res.ok) return toast.error(j.error || 'Could not sync settlements.')
    if (j.status === 'error') toast.error(j.errors?.[0]?.message || 'Razorpay did not answer.')
    else toast.success(`Synced ${count(j.counts?.settlements ?? 0)} settlement(s), ${count(j.counts?.lines ?? 0)} line(s).`)
    overview.reload()
    awaiting.reload()
  }

  const d = overview.data
  const busy = syncing || !!d?.sync.running
  const syncBtn = canWrite ? (
    <button
      type="button"
      onClick={sync}
      disabled={busy}
      className="control-md border border-border-default bg-surface-elevated text-foreground font-medium hover:bg-surface-secondary disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Syncing…' : 'Sync now'}
    </button>
  ) : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FinancePeriodBar onRefresh={() => (overview.reload(), awaiting.reload())} busy={overview.loading} />
        <div className="flex items-center gap-3">
          {d && (
            <span className="text-xs text-foreground-muted">
              {d.sync.last_at ? `Last synced ${fmtTime(d.sync.last_at)}` : 'Not synced yet'}
              {d.sync.last_status === 'error' || d.sync.last_status === 'partial' ? ' · with errors' : ''}
            </span>
          )}
          {syncBtn}
        </div>
      </div>
      {overview.error && <Banner ok={false}>{overview.error}</Banner>}
      {d?.sync.last_error && d.sync.last_status !== 'success' && <Banner ok={false}>Last sync: {d.sync.last_error}</Banner>}
      {overview.loading && !d ? <OverviewSkeleton /> : d && <Body d={d} awaiting={awaiting.data} />}
    </div>
  )
}

function Body({ d, awaiting }: { d: SettlementOverview; awaiting: AwaitingSettlement | null }) {
  const t = d.totals
  const flagship = d.account === 'platform'
  const othersAwaiting = awaiting?.stores.reduce((a, s) => a + s.amount, 0) ?? 0
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Settled to bank" value={money(t.settled)} sub={`${count(t.count)} settlements`} highlight />
        <Kpi label="Razorpay fees + GST" value={money(t.fees)} sub={`incl. ${money(t.tax)} GST`} />
        <Kpi label="Awaiting settlement" value={money(awaiting?.total ?? 0)} sub={`${count(awaiting?.count ?? 0)} payments`} />
        {flagship && <Kpi label="Transferred to stores" value={money(t.to_stores)} sub="Route transfers in these settlements" />}
      </KpiGrid>

      <Section title="Settlements">
        {d.settlements.length ? (
          <SettlementsTable rows={d.settlements} />
        ) : (
          <p className="text-sm text-foreground-muted text-center py-8">
            {d.sync.last_at ? 'No settlements in this period.' : 'Press Sync now to read your settlements from Razorpay.'}
          </p>
        )}
      </Section>

      <Section title="Awaiting settlement">
        <AwaitingTable rows={awaiting?.rows ?? []} />
        {flagship && awaiting && awaiting.stores.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold text-foreground">Other stores&apos; sales on the platform account · {money(othersAwaiting)}</p>
            <div className="flex flex-wrap gap-2">
              {awaiting.stores.map(s => (
                <span key={s.slug} className="rounded-md border border-border-default px-2.5 py-1 text-xs text-foreground-secondary">
                  {s.slug} · {count(s.count)} · {money(s.amount)}
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

function SettlementsTable({ rows }: { rows: SettlementRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className={`${tableWrapCls} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead className={theadCls}>
          <tr>
            <th className={thCls} />
            <th className={thCls}>Settled</th>
            <th className={thCls}>Settlement</th>
            <th className={thCls}>UTR</th>
            <th className={thRight}>To bank</th>
            <th className={thRight}>Fees + GST</th>
            <th className={thRight}>Lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <Fragment key={r.id}>
              <tr className="border-b border-border-default hover:bg-surface-secondary/50 cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td className="px-4 py-2.5 w-8 text-foreground-muted">{open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(r.settled_at)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.id}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.utr || '-'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(r.amount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(r.fees)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {count(r.item_count)}
                  {r.mismatch && <span className={`${badgeCls('amber')} ml-2`} title={`Lines add up to ${money(r.lines_net)}`}>doesn&apos;t add up</span>}
                </td>
              </tr>
              {open === r.id && (
                <tr className="border-b border-border-default bg-surface-secondary/30">
                  <td colSpan={7} className="px-4 py-3">
                    <SettlementLines id={r.id} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SettlementLines({ id }: { id: string }) {
  const { data, error, loading } = useOverviewData<SettlementDetail>(`/api/admin/financial/razorpay-settlements/${encodeURIComponent(id)}`)
  if (loading) return <p className="text-xs text-foreground-muted">Loading lines…</p>
  if (error || !data) return <p className="text-xs text-red-600">{error || 'Could not load the lines.'}</p>
  if (!data.groups.length) return <p className="text-xs text-foreground-muted">Razorpay sent no lines for this settlement yet. Sync again later.</p>
  const s = data.settlement
  return (
    <div className="space-y-4">
      {s.mismatch && (
        <Banner ok={false}>
          The lines add up to {money(s.lines_net)}, but {money(s.amount)} reached the bank. Some lines may not be synced yet.
        </Banner>
      )}
      {data.groups.map(g => (
        <div key={g.key} className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">{g.label}</span>
            <span className="text-xs text-foreground-muted tabular-nums">
              {count(g.lines.length)} lines · net {money(g.net)}
              {g.fees ? ` · fees ${money(g.fees)}` : ''}
            </span>
          </div>
          <Table rows={g.lines} cols={LINE_COLS} rowKey={l => l.entity_id} pageSize={10} />
        </div>
      ))}
    </div>
  )
}

const LINE_COLS: Col<SettlementLine>[] = [
  {
    key: 'what',
    label: 'For',
    render: l =>
      l.order_id ? (
        <Link href={`/admin/orders/${l.order_id}/view`} className="text-accent-500 hover:underline font-mono text-xs">
          #{l.order_number}
        </Link>
      ) : l.source_order_ref ? (
        <span className="font-mono text-xs">{l.source_order_ref}</span>
      ) : (
        <span className="text-xs text-foreground-muted">{l.description || '-'}</span>
      ),
  },
  { key: 'type', label: 'Type', render: l => TYPE_LABEL[l.type] ?? l.type },
  { key: 'id', label: 'Razorpay id', render: l => <span className="font-mono text-xs">{l.entity_id}</span> },
  { key: 'amount', label: 'Amount', num: true, sort: l => l.amount, render: l => money(l.amount) },
  { key: 'fee', label: 'Fee + GST', num: true, render: l => (l.fee ? money(l.fee) : '-') },
  { key: 'net', label: 'Net', num: true, sort: l => l.credit - l.debit, render: l => money(l.credit - l.debit) },
  { key: 'at', label: 'Paid', render: l => fmtDate(l.entity_created_at) },
]

function AwaitingTable({ rows }: { rows: AwaitingRow[] }) {
  const cols: Col<AwaitingRow>[] = [
    {
      key: 'order',
      label: 'Order',
      render: r => (
        <Link href={`/admin/orders/${r.order_id}/view`} className="text-accent-500 hover:underline font-mono text-xs">
          #{r.order_number}
        </Link>
      ),
    },
    { key: 'payment', label: 'Payment', render: r => <span className="font-mono text-xs">{r.payment_id}</span> },
    { key: 'amount', label: 'Amount', num: true, sort: r => r.amount, render: r => money(r.amount) },
    { key: 'captured', label: 'Paid', sort: r => r.captured_at, render: r => fmtTime(r.captured_at) },
    { key: 'expected', label: 'Expected by', sort: r => r.estimated_at, render: r => fmtDate(r.estimated_at) },
  ]
  return <Table rows={rows} cols={cols} rowKey={r => r.payment_id} empty="Every payment from the last 30 days has settled." />
}
