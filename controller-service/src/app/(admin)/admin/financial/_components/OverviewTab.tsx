'use client'

import { useEffect, useState } from 'react'
import { formatINR } from './shared'
import { delta, pctStr, rsCompact } from '@/components/admin/dashboard/Primitives'
import { PctBadge } from '@/components/admin/dashboard/StatCard'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import {
  CashflowTrendCard,
  OutflowDonutCard,
  PlTrendCard,
  TopPayablesCard,
  type CashflowPoint,
  type OutflowSegment,
  type PlPoint,
  type RankedItem,
} from './OverviewCharts'

type CardState = {
  value: string
  sub?: string
  tone?: 'default' | 'positive' | 'negative' | 'warning'
  failed?: boolean
  pct?: number | null
  invert?: boolean
}

const fyRange = () => {
  const now = new Date()
  const start = now.getMonth() >= 3 ? `${now.getFullYear()}-04-01` : `${now.getFullYear() - 1}-04-01`
  const end = now.getMonth() >= 3 ? `${now.getFullYear() + 1}-03-31` : `${now.getFullYear()}-03-31`
  return { start, end }
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url)
    const json = await res.json()
    return json?.error ? null : json
  } catch {
    return null
  }
}

const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0)

type Charts = {
  cashflow: CashflowPoint[]
  pl: PlPoint[]
  outflow: OutflowSegment[] | null
  outflowTotal: number
  payables: RankedItem[]
}

const OUTFLOW_COLORS = { po: 'rgb(239 68 68)', refunds: 'rgb(234 179 8)' }

export function OverviewTab() {
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<Record<string, CardState>>({})
  const [charts, setCharts] = useState<Charts | null>(null)

  useEffect(() => {
    let active = true
    const { start, end } = fyRange()

    Promise.all([
      getJson('/api/admin/financial/transactions'),
      getJson('/api/admin/financial/receivables'),
      getJson('/api/admin/financial/payables'),
      getJson('/api/admin/financial/cod-remittance?status=cod_pending'),
      getJson(`/api/admin/financial/pl?from=${start}&to=${end}`),
      getJson(`/api/admin/financial/cashflow?from=${start}&to=${end}`),
    ]).then(([txn, rec, pay, cod, pl, cash]) => {
      if (!active) return

      const txnSummary = txn?.summary
      const inflow = num(txnSummary?.total_inflow)
      const outflow = num(txnSummary?.total_outflow)
      const net = num(txnSummary?.net)

      const codOrders: any[] = Array.isArray(cod?.orders) ? cod.orders : []
      const codPendingCount = num(cod?.summary?.cod_pending)
      const codPendingAmount = codOrders.reduce((s, o) => s + num(o.total_amount), 0)

      const overdueAmount = num(pay?.summary?.overdue)

      const cashMonths: any[] = Array.isArray(cash?.monthly) ? cash.monthly : []
      const plMonths: any[] = Array.isArray(pl?.monthly) ? pl.monthly : []

      // Net delta: last populated month vs the one before it.
      const netSeries = cashMonths.map(m => num(m.net))
      const curNet = netSeries.length ? netSeries[netSeries.length - 1] : null
      const prevNet = netSeries.length > 1 ? netSeries[netSeries.length - 2] : null

      const plNetSeries = plMonths.map(m => num(m.net_revenue))
      const curPlNet = plNetSeries.length ? plNetSeries[plNetSeries.length - 1] : null
      const prevPlNet = plNetSeries.length > 1 ? plNetSeries[plNetSeries.length - 2] : null

      setCards({
        inflow: txnSummary ? { value: formatINR(inflow), tone: 'positive' } : { value: 'No data', failed: true },
        outflow: txnSummary ? { value: formatINR(outflow), tone: 'negative' } : { value: 'No data', failed: true },
        net: txnSummary
          ? {
              value: formatINR(net),
              tone: net >= 0 ? 'positive' : 'negative',
              pct: delta(curNet, prevNet),
              sub: curNet != null && prevNet != null ? 'Latest month vs previous' : undefined,
            }
          : { value: 'No data', failed: true },
        receivables: rec?.summary
          ? { value: formatINR(num(rec.summary.total)), sub: 'Outstanding' }
          : { value: 'No data', failed: true },
        payables: pay?.summary
          ? {
              value: formatINR(num(pay.summary.total_payable)),
              sub: overdueAmount > 0 ? `${formatINR(overdueAmount)} overdue` : 'None overdue',
              tone: overdueAmount > 0 ? 'warning' : 'default',
            }
          : { value: 'No data', failed: true },
        cod: cod?.summary
          ? {
              value: formatINR(codPendingAmount),
              sub: `${codPendingCount} order${codPendingCount === 1 ? '' : 's'} pending`,
            }
          : { value: 'No data', failed: true },
        plNet: pl?.totals
          ? {
              value: formatINR(num(pl.totals.net_revenue)),
              sub: 'This financial year',
              pct: delta(curPlNet, prevPlNet),
            }
          : { value: 'No data', failed: true },
      })

      const poTotal = cashMonths.reduce((s, m) => s + num(m.po_payments), 0)
      const refundsTotal = cashMonths.reduce((s, m) => s + num(m.refunds_out), 0)
      const outflowTotal = poTotal + refundsTotal
      const outflowSegs: OutflowSegment[] =
        outflowTotal > 0
          ? [
              { label: 'Supplier / PO payments', value: poTotal, color: OUTFLOW_COLORS.po },
              { label: 'Refunds', value: refundsTotal, color: OUTFLOW_COLORS.refunds },
            ].filter(s => s.value > 0)
          : []

      const payableRows: any[] = Array.isArray(pay?.rows) ? pay.rows : []
      const bySupplier = new Map<string, number>()
      for (const r of payableRows) {
        const name = String(r.supplier_name || 'Unknown supplier')
        const remaining = num(r.total_amount) - num(r.paid_amount)
        if (remaining > 0) bySupplier.set(name, (bySupplier.get(name) || 0) + remaining)
      }
      const payables: RankedItem[] = [...bySupplier.entries()]
        .map(([name, value]) => ({ name, value, sub: formatINR(value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6)

      setCharts({
        cashflow: cashMonths.map(
          (m): CashflowPoint => ({
            month: String(m.month),
            cashIn: num(m.cash_in),
            cashOut: num(m.cash_out),
            net: num(m.net),
          })
        ),
        pl: plMonths.map((m): PlPoint => ({ month: String(m.month), netRevenue: num(m.net_revenue) })),
        outflow: outflowSegs.length ? outflowSegs : null,
        outflowTotal,
        payables,
      })

      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="space-y-5">
        <AdminStatsSkeleton cards={7} gridClass="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
        <ChartSkeleton bodyClass="h-40" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSkeleton bodyClass="h-44" />
          <ChartSkeleton bodyClass="h-44" />
        </div>
        <ChartSkeleton bodyClass="h-40" />
      </div>
    )
  }

  const hasCashflow = (charts?.cashflow.length ?? 0) > 0
  const hasPl = (charts?.pl.length ?? 0) > 0
  const hasOutflow = !!charts?.outflow
  const hasPayables = (charts?.payables.length ?? 0) > 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard label="Total Inflow" state={cards.inflow} />
        <KPICard label="Total Outflow" state={cards.outflow} />
        <KPICard label="Net" state={cards.net} />
        <KPICard label="Receivables Outstanding" state={cards.receivables} />
        <KPICard label="Payables Due" state={cards.payables} />
        <KPICard label="COD Pending Remittance" state={cards.cod} />
        <KPICard label="Net Revenue" state={cards.plNet} />
      </div>

      {hasCashflow && <CashflowTrendCard data={charts!.cashflow} />}

      {(hasOutflow || hasPayables) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {hasOutflow && <OutflowDonutCard segments={charts!.outflow!} total={rsCompact(charts!.outflowTotal)} />}
          {hasPayables && <TopPayablesCard items={charts!.payables} />}
        </div>
      )}

      {hasPl && <PlTrendCard data={charts!.pl} />}
    </div>
  )
}

const toneCls: Record<NonNullable<CardState['tone']>, string> = {
  default: 'text-foreground',
  positive: 'text-green-600 dark:text-green-400',
  negative: 'text-red-600 dark:text-red-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
}

function KPICard({ label, state }: { label: string; state?: CardState }) {
  const s = state ?? { value: 'No data', failed: true }
  const valueCls = s.failed ? 'text-foreground-secondary' : toneCls[s.tone ?? 'default']
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default px-5 py-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-secondary">{label}</p>
        {!s.failed && s.pct !== undefined && <PctBadge value={s.pct ?? null} invert={s.invert} />}
      </div>
      <p className={`text-2xl font-bold ${valueCls}`}>{s.value}</p>
      {s.sub && <p className="text-xs text-foreground-secondary mt-0.5">{s.sub}</p>}
      {!s.failed && s.pct != null && !s.sub && (
        <p className="text-xs text-foreground-secondary mt-0.5">{pctStr(s.pct)} vs previous month</p>
      )}
    </div>
  )
}

function ChartSkeleton({ bodyClass }: { bodyClass: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 animate-fade-in">
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-4 w-40 bg-surface-secondary rounded" />
        <div className={`w-full bg-surface-secondary rounded ${bodyClass}`} />
      </div>
    </div>
  )
}
