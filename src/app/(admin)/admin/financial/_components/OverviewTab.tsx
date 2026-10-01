'use client'

import { useEffect, useState } from 'react'
import { formatINR } from './shared'

type CardState = { value: string; sub?: string; tone?: 'default' | 'positive' | 'negative' | 'warning'; failed?: boolean }

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

export function OverviewTab() {
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<Record<string, CardState>>({})

  useEffect(() => {
    let active = true
    const { start, end } = fyRange()

    Promise.all([
      getJson('/api/admin/financial/transactions'),
      getJson('/api/admin/financial/receivables'),
      getJson('/api/admin/financial/payables'),
      getJson('/api/admin/financial/cod-remittance?status=cod_pending'),
      getJson(`/api/admin/financial/pl?from=${start}&to=${end}`),
    ]).then(([txn, rec, pay, cod, pl]) => {
      if (!active) return

      const txnSummary = txn?.summary
      const inflow = num(txnSummary?.total_inflow)
      const outflow = num(txnSummary?.total_outflow)
      const net = num(txnSummary?.net)

      const codOrders: any[] = Array.isArray(cod?.orders) ? cod.orders : []
      const codPendingCount = num(cod?.summary?.cod_pending)
      const codPendingAmount = codOrders.reduce((s, o) => s + num(o.total_amount), 0)

      const overdueAmount = num(pay?.summary?.overdue)

      setCards({
        inflow: txnSummary
          ? { value: formatINR(inflow), tone: 'positive' }
          : { value: 'No data', failed: true },
        outflow: txnSummary
          ? { value: formatINR(outflow), tone: 'negative' }
          : { value: 'No data', failed: true },
        net: txnSummary
          ? { value: formatINR(net), tone: net >= 0 ? 'positive' : 'negative' }
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
          ? { value: formatINR(num(pl.totals.net_revenue)), sub: 'This financial year' }
          : { value: 'No data', failed: true },
      })
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <KPICardSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <KPICard label="Total Inflow" state={cards.inflow} />
      <KPICard label="Total Outflow" state={cards.outflow} />
      <KPICard label="Net" state={cards.net} />
      <KPICard label="Receivables Outstanding" state={cards.receivables} />
      <KPICard label="Payables Due" state={cards.payables} />
      <KPICard label="COD Pending Remittance" state={cards.cod} />
      <KPICard label="Net Revenue" state={cards.plNet} />
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
      <p className="text-xs font-medium uppercase tracking-wide text-foreground-secondary mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueCls}`}>{s.value}</p>
      {s.sub && <p className="text-xs text-foreground-secondary mt-0.5">{s.sub}</p>}
    </div>
  )
}

function KPICardSkeleton() {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default px-5 py-4">
      <div className="h-3 w-24 bg-surface-secondary rounded motion-safe:animate-pulse mb-3" />
      <div className="h-7 w-32 bg-surface-secondary rounded motion-safe:animate-pulse" />
      <div className="h-3 w-20 bg-surface-secondary rounded motion-safe:animate-pulse mt-2" />
    </div>
  )
}
