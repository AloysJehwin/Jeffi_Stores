'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col, type Tone } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { KeyedTrendCard, MixDonutCard, type TrendPoint } from '@/components/admin/kit/charts'
import { badgeCls, useActionToast } from '@/components/admin/kit'
import { delta } from '@/lib/overview/period'
import { FinancePeriodBar, useFinancePeriod, type FinanceOverviewContract } from './finance'

type Totals = {
  collected_count: number; collected_amount: number
  pending_count: number; pending_amount: number
  remitted_count: number; remitted_amount: number
}

type StatusKey = 'cod_pending' | 'cod_collected' | 'paid'
type ByStatus = { key: StatusKey; count: number; amount: number }
type TopRow = {
  id: string
  order_number: string
  customer_name: string | null
  payment_status: string
  total_amount: number
  delivered_at: string | null
  cod_remitted_at: string | null
}

type CodOverview = Omit<FinanceOverviewContract<Totals, ByStatus>, 'series' | 'top'> & {
  series: TrendPoint[]
  by_dim: ByStatus[]
  top: TopRow[]
}

type StatusFilter = StatusKey | 'all'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cod_collected', label: 'Collected' },
  { value: 'cod_pending', label: 'Pending' },
  { value: 'paid', label: 'Remitted' },
]

const STATUS_META: Record<StatusKey, { label: string; tone: Tone; color: string }> = {
  cod_collected: { label: 'Collected', tone: 'blue', color: 'rgb(59 130 246)' },
  cod_pending: { label: 'Pending', tone: 'amber', color: 'rgb(245 158 11)' },
  paid: { label: 'Remitted', tone: 'green', color: 'rgb(16 185 129)' },
}

const SERIES_LABEL: Record<string, string> = { collected: 'Collected', remitted: 'Remitted' }

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '-'

export function CodRemittanceTab() {
  const { range } = useFinancePeriod()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const canWrite = useCanWrite('financial:write')
  const toast = useActionToast()
  const url = `/api/admin/financial/cod-remittance?from=${range.from}&to=${range.to}&status=${status}`
  const { data, error, loading, reload } = useOverviewData<CodOverview>(url)

  async function markRemitted(ids: string[]) {
    if (!ids.length) return
    setMarking(true)
    const res = await fetch('/api/admin/financial/cod-remittance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: ids }),
    })
    const j = await res.json().catch(() => ({}))
    setMarking(false)
    if (j.success) {
      toast.success(`Marked ${j.marked} order(s) as remitted.`)
      setSelected(new Set())
      reload()
    } else {
      toast.error(j.error || 'Could not mark as remitted.')
    }
  }

  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      <StatusPills value={status} onChange={v => { setStatus(v); setSelected(new Set()) }} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && (
        <Body
          d={data}
          canWrite={canWrite}
          selected={selected}
          setSelected={setSelected}
          marking={marking}
          markRemitted={markRemitted}
        />
      )}
    </div>
  )
}

function StatusPills({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <div className="flex h-control max-w-full overflow-x-auto rounded-lg border border-border-default text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {STATUS_FILTERS.map(f => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          className={`h-full px-4 transition-colors font-medium ${value === f.value ? 'bg-accent-500 text-white' : 'bg-surface-elevated text-foreground-secondary hover:bg-surface-secondary'}`}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

function Body({
  d,
  canWrite,
  selected,
  setSelected,
  marking,
  markRemitted,
}: {
  d: CodOverview
  canWrite: boolean
  selected: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  marking: boolean
  markRemitted: (ids: string[]) => void
}) {
  const c = d.current
  const p = d.previous
  // Only cod_collected rows can be marked remitted (POST filter enforces this too).
  const canSelect = (r: TopRow) => canWrite && r.payment_status === 'cod_collected'

  const toggle = (id: string, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(id); else next.delete(id)
      return next
    })

  const eligible = d.top.filter(canSelect)
  const allChecked = eligible.length > 0 && eligible.every(r => selected.has(r.id))
  const toggleAll = (on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev)
      for (const r of eligible) on ? next.add(r.id) : next.delete(r.id)
      return next
    })

  const cols: Col<TopRow>[] = [
    ...(canWrite
      ? [{
          key: 'sel',
          label: '',
          render: (r: TopRow) =>
            canSelect(r) ? (
              <input
                type="checkbox"
                aria-label={`Select order ${r.order_number}`}
                checked={selected.has(r.id)}
                onChange={e => toggle(r.id, e.target.checked)}
              />
            ) : null,
        } satisfies Col<TopRow>]
      : []),
    {
      key: 'order',
      label: 'Order',
      render: r => (
        <Link href={`/admin/orders/${r.id}/view`} className="text-accent-500 hover:underline font-mono text-xs">
          #{r.order_number}
        </Link>
      ),
    },
    { key: 'customer', label: 'Customer', render: r => r.customer_name ?? '-' },
    { key: 'amount', label: 'Amount', num: true, render: r => money(r.total_amount) },
    {
      key: 'status',
      label: 'Status',
      render: r => {
        const meta = STATUS_META[r.payment_status as StatusKey]
        return <span className={badgeCls(meta?.tone ?? 'muted')}>{meta?.label ?? r.payment_status}</span>
      },
    },
    { key: 'delivered', label: 'Delivered', render: r => fmtDate(r.delivered_at) },
    { key: 'remitted', label: 'Remitted', render: r => fmtDate(r.cod_remitted_at) },
  ]

  const sectionActions = canWrite ? (
    <div className="flex flex-wrap items-center gap-3">
      {eligible.length > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
          <input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} />
          Select all collected
        </label>
      )}
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => markRemitted(Array.from(selected))}
          disabled={marking}
          className="control-sm bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50 rounded-md"
        >
          {marking ? 'Marking…' : `Mark ${selected.size} remitted`}
        </button>
      )}
    </div>
  ) : null

  const mixSegments = d.by_dim
    .filter(r => r.amount > 0)
    .map(r => ({ label: STATUS_META[r.key].label, value: r.amount, color: STATUS_META[r.key].color }))

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Collected" value={money(c.collected_amount)} sub={`${count(c.collected_count)} orders`} delta={delta(c.collected_amount, p.collected_amount)} highlight />
        <Kpi label="Pending" value={money(c.pending_amount)} sub={`${count(c.pending_count)} orders`} delta={delta(c.pending_amount, p.pending_amount)} invert />
        <Kpi label="Remitted" value={money(c.remitted_amount)} sub={`${count(c.remitted_count)} orders`} delta={delta(c.remitted_amount, p.remitted_amount)} />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title="Weekly collection"
            data={d.series}
            keys={['collected', 'remitted']}
            labels={SERIES_LABEL}
            granularity={d.bucket}
          />
        </div>
        <MixDonutCard
          title="By status"
          segments={mixSegments}
          total={money(c.collected_amount + c.pending_amount + c.remitted_amount)}
          totalLabel="COD this period"
        />
      </div>

      <Section title="Orders" action={sectionActions}>
        <Table
          rows={d.top}
          cols={cols}
          rowKey={r => r.id}
          empty="No COD orders in this period."
        />
      </Section>
    </div>
  )
}
