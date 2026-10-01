'use client'

import { useEffect, useState } from 'react'
import { formatINR } from '@/lib/shared/format'

const OPEN_PO_STATUSES = ['draft', 'sent', 'partial']

type CardState<T> = { status: 'loading' | 'ready' | 'error'; data?: T }

function initial<T>(): CardState<T> {
  return { status: 'loading' }
}

type ValuationState = { totalValue: number; skuCount: number; lowStock: number | null; outOfStock: number }
type PoState = { count: number; value: number }
type SupplierState = { active: number }

function KpiCard({
  label,
  state,
  render,
  accent,
}: {
  label: string
  state: CardState<any>
  render: (data: any) => { value: string; sub?: string }
  accent?: 'default' | 'warning'
}) {
  const tone =
    accent === 'warning'
      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40'
      : 'bg-surface-elevated border-border-default'
  const valueTone = accent === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <p className="text-xs font-medium text-foreground-secondary mb-1">{label}</p>
      {state.status === 'loading' && (
        <div className="motion-safe:animate-pulse space-y-2 pt-1">
          <div className="h-6 w-24 rounded bg-surface-secondary" />
          <div className="h-3 w-16 rounded bg-surface-secondary" />
        </div>
      )}
      {state.status === 'error' && <p className="text-sm text-foreground-muted pt-1">Unavailable</p>}
      {state.status === 'ready' &&
        (() => {
          const { value, sub } = render(state.data)
          return (
            <>
              <p className={`text-xl font-bold ${valueTone}`}>{value}</p>
              {sub && <p className="text-xs text-foreground-muted mt-0.5">{sub}</p>}
            </>
          )
        })()}
    </div>
  )
}

export default function InventoryOverviewTab() {
  const [valuation, setValuation] = useState<CardState<ValuationState>>(initial)
  const [po, setPo] = useState<CardState<PoState>>(initial)
  const [suppliers, setSuppliers] = useState<CardState<SupplierState>>(initial)

  useEffect(() => {
    let cancelled = false

    async function loadValuation() {
      try {
        const [valRes, lowRes] = await Promise.all([
          fetch('/api/admin/inventory/stock?view=valuation&limit=1'),
          fetch('/api/admin/inventory/stock?view=valuation&limit=1&stock_status=low_stock').catch(() => null),
        ])
        if (!valRes.ok) throw new Error('valuation')
        const val = await valRes.json()
        const low = lowRes?.ok ? await lowRes.json() : null
        if (cancelled) return
        const skuCount = Number(val?.total) || 0
        const inStock = Number(val?.inStockCount) || 0
        setValuation({
          status: 'ready',
          data: {
            totalValue: Number(val?.totalValue) || 0,
            skuCount,
            outOfStock: Math.max(0, skuCount - inStock),
            lowStock: low && typeof low.total === 'number' ? low.total : null,
          },
        })
      } catch {
        if (!cancelled) setValuation({ status: 'error' })
      }
    }

    async function loadPo() {
      try {
        const res = await fetch('/api/admin/inventory/po?limit=1000')
        if (!res.ok) throw new Error('po')
        const json = await res.json()
        const open = (json?.purchase_orders || []).filter((p: any) => OPEN_PO_STATUSES.includes(p.status))
        if (cancelled) return
        setPo({
          status: 'ready',
          data: {
            count: open.length,
            value: open.reduce((s: number, p: any) => s + (parseFloat(p.total_amount || '0') || 0), 0),
          },
        })
      } catch {
        if (!cancelled) setPo({ status: 'error' })
      }
    }

    async function loadSuppliers() {
      try {
        const res = await fetch('/api/admin/inventory/suppliers?limit=1')
        if (!res.ok) throw new Error('suppliers')
        const json = await res.json()
        if (cancelled) return
        setSuppliers({ status: 'ready', data: { active: Number(json?.total) || 0 } })
      } catch {
        if (!cancelled) setSuppliers({ status: 'error' })
      }
    }

    loadValuation()
    loadPo()
    loadSuppliers()
    return () => {
      cancelled = true
    }
  }, [])

  const lowOutReady =
    valuation.status === 'ready' && (valuation.data!.lowStock !== null || valuation.data!.outOfStock > 0)
  const showLowOut = valuation.status !== 'ready' || lowOutReady || valuation.data!.skuCount > 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total stock value"
          state={valuation}
          render={d => ({ value: formatINR(d.totalValue, 0), sub: `${d.skuCount} SKUs, cost basis` })}
        />
        <KpiCard
          label="Open purchase orders"
          state={po}
          render={d => ({ value: String(d.count), sub: `${formatINR(d.value, 0)} pending` })}
        />
        <KpiCard
          label="Active suppliers"
          state={suppliers}
          render={d => ({ value: String(d.active) })}
        />
        {showLowOut && (
          <KpiCard
            label="Low / out of stock"
            state={valuation}
            accent="warning"
            render={d => ({
              value: d.lowStock !== null ? String(d.lowStock) : String(d.outOfStock),
              sub: d.lowStock !== null ? `${d.outOfStock} out of stock` : 'SKUs out of stock',
            })}
          />
        )}
      </div>
    </div>
  )
}
