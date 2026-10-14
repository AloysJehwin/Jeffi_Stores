'use client'

import { useEffect, useState } from 'react'
import { formatINR } from '@/lib/shared/format'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import {
  LowStockWatchlistCard,
  PoValueTrendCard,
  StockValueDonutCard,
  TopStockValueCard,
  type DonutSegment,
  type PoTrendPoint,
  type RankedItem,
} from './InventoryOverviewCharts'

const OPEN_PO_STATUSES = ['draft', 'sent', 'partial']

const CATEGORY_PALETTE = [
  'rgb(59 130 246)',
  'rgb(16 185 129)',
  'rgb(168 85 247)',
  'rgb(234 179 8)',
  'rgb(236 72 153)',
  'rgb(14 165 233)',
  'rgb(249 115 22)',
]
const OTHER_COLOR = 'rgb(148 163 184)'

type CardState<T> = { status: 'loading' | 'ready' | 'error'; data?: T }

function initial<T>(): CardState<T> {
  return { status: 'loading' }
}

type ValuationState = { totalValue: number; skuCount: number }
type StockLevelsState = { lowStock: number; outOfStock: number }
type PoState = { count: number; value: number }
type SupplierState = { active: number }

function rowLabel(p: any): string {
  const leaf = [p.variant_name, p.sub_variant_name].filter(Boolean).join(' / ')
  return leaf ? `${p.name} — ${leaf}` : p.name
}

function sumStockValue(products: any[]): number {
  return products.reduce((s, p) => s + (Number(p.stock_value) || 0), 0)
}

function buildCategorySegments(products: any[]): DonutSegment[] {
  const byCat = new Map<string, number>()
  for (const p of products) {
    const v = Number(p.stock_value) || 0
    if (v <= 0) continue
    const name = p.category_name || 'Uncategorized'
    byCat.set(name, (byCat.get(name) || 0) + v)
  }
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted.slice(0, CATEGORY_PALETTE.length)
  const rest = sorted.slice(CATEGORY_PALETTE.length)
  const segments: DonutSegment[] = top.map(([label, value], idx) => ({
    label,
    value,
    color: CATEGORY_PALETTE[idx],
  }))
  const restTotal = rest.reduce((s, [, v]) => s + v, 0)
  if (restTotal > 0) segments.push({ label: 'Other', value: restTotal, color: OTHER_COLOR })
  return segments
}

function buildTopProducts(products: any[]): RankedItem[] {
  const byProduct = new Map<string, { name: string; value: number }>()
  for (const p of products) {
    const v = Number(p.stock_value) || 0
    if (v <= 0) continue
    const key = p.id
    const prev = byProduct.get(key)
    if (prev) prev.value += v
    else byProduct.set(key, { name: p.name, value: v })
  }
  return [...byProduct.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map(it => ({ name: it.name, value: it.value, sub: formatINR(it.value, 0) }))
}

function buildLowStock(products: any[]): RankedItem[] {
  return products
    .filter(p => (Number(p.inventory_quantity) || 0) > 0)
    .sort((a, b) => (Number(a.inventory_quantity) || 0) - (Number(b.inventory_quantity) || 0))
    .slice(0, 8)
    .map(p => {
      const qty = Number(p.inventory_quantity) || 0
      const unit = p.base_unit_label || p.sell_unit_label || ''
      return {
        name: rowLabel(p),
        value: qty,
        sub: `${qty.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''} left`,
      }
    })
}

function buildPoTrend(rows: any[]): PoTrendPoint[] {
  const byMonth = new Map<string, number>()
  for (const r of rows) {
    const raw = r.order_date || r.created_at
    if (!raw) continue
    const d = new Date(raw)
    if (isNaN(d.getTime())) continue
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byMonth.set(month, (byMonth.get(month) || 0) + (parseFloat(r.total_amount || '0') || 0))
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([month, value]) => ({ month, value }))
}

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

type ChartsState = {
  categorySegments: DonutSegment[]
  categoryTotal: number
  topProducts: RankedItem[]
}

export default function InventoryOverviewTab() {
  const [valuation, setValuation] = useState<CardState<ValuationState>>(initial)
  const [stockLevels, setStockLevels] = useState<CardState<StockLevelsState>>(initial)
  const [po, setPo] = useState<CardState<PoState>>(initial)
  const [suppliers, setSuppliers] = useState<CardState<SupplierState>>(initial)
  const [charts, setCharts] = useState<CardState<ChartsState>>(initial)
  const [lowStock, setLowStock] = useState<CardState<RankedItem[]>>(initial)
  const [poTrend, setPoTrend] = useState<CardState<PoTrendPoint[]>>(initial)

  useEffect(() => {
    let cancelled = false

    async function loadValuation() {
      try {
        const valRes = await fetch('/api/admin/inventory/stock?view=valuation&limit=1')
        if (!valRes.ok) throw new Error('valuation')
        const val = await valRes.json()
        if (cancelled) return
        setValuation({
          status: 'ready',
          data: {
            totalValue: Number(val?.totalValue) || 0,
            skuCount: Number(val?.total) || 0,
          },
        })
      } catch {
        if (!cancelled) setValuation({ status: 'error' })
      }
    }

    async function loadStockLevels() {
      try {
        const res = await fetch('/api/admin/inventory/stock-levels')
        if (!res.ok) throw new Error('stock_levels')
        const json = await res.json()
        if (cancelled) return
        setStockLevels({
          status: 'ready',
          data: {
            lowStock: Number(json?.low_stock) || 0,
            outOfStock: Number(json?.out_of_stock) || 0,
          },
        })
      } catch {
        if (!cancelled) setStockLevels({ status: 'error' })
      }
    }

    async function loadPo() {
      try {
        const res = await fetch('/api/admin/inventory/po?limit=1000')
        if (!res.ok) throw new Error('po')
        const json = await res.json()
        const rows = json?.purchase_orders || []
        const open = rows.filter((p: any) => OPEN_PO_STATUSES.includes(p.status))
        if (cancelled) return
        setPo({
          status: 'ready',
          data: {
            count: open.length,
            value: open.reduce((s: number, p: any) => s + (parseFloat(p.total_amount || '0') || 0), 0),
          },
        })
        setPoTrend({ status: 'ready', data: buildPoTrend(rows) })
      } catch {
        if (!cancelled) {
          setPo({ status: 'error' })
          setPoTrend({ status: 'error' })
        }
      }
    }

    async function loadCharts() {
      try {
        const res = await fetch('/api/admin/inventory/stock?view=valuation&limit=5000')
        if (!res.ok) throw new Error('charts')
        const json = await res.json()
        if (cancelled) return
        const products = (json?.products || []) as any[]
        setCharts({
          status: 'ready',
          data: {
            categorySegments: buildCategorySegments(products),
            categoryTotal: Number(json?.totalValue) || sumStockValue(products),
            topProducts: buildTopProducts(products),
          },
        })
      } catch {
        if (!cancelled) setCharts({ status: 'error' })
      }
    }

    async function loadLowStock() {
      try {
        const res = await fetch('/api/admin/inventory/stock?view=valuation&limit=5000&sort=stock&dir=asc')
        if (!res.ok) throw new Error('low_stock')
        const json = await res.json()
        if (cancelled) return
        setLowStock({ status: 'ready', data: buildLowStock((json?.products || []) as any[]) })
      } catch {
        if (!cancelled) setLowStock({ status: 'error' })
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
    loadStockLevels()
    loadPo()
    loadSuppliers()
    loadCharts()
    loadLowStock()
    return () => {
      cancelled = true
    }
  }, [])

  const kpisLoading =
    valuation.status === 'loading' ||
    po.status === 'loading' ||
    suppliers.status === 'loading' ||
    stockLevels.status === 'loading'

  return (
    <div className="space-y-5">
      {kpisLoading ? (
        <AdminStatsSkeleton cards={4} gridClass="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" />
      ) : (
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
          <KpiCard
            label="Low / out of stock"
            state={stockLevels}
            accent="warning"
            render={d => ({
              value: `${d.lowStock} low`,
              sub: `${d.outOfStock} out of stock`,
            })}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSlot state={charts} empty={d => d.categorySegments.length === 0}>
          {d => <StockValueDonutCard segments={d.categorySegments} total={formatINR(d.categoryTotal, 0)} />}
        </ChartSlot>
        <ChartSlot state={charts} empty={d => d.topProducts.length === 0}>
          {d => <TopStockValueCard items={d.topProducts} />}
        </ChartSlot>
        <ChartSlot state={lowStock} empty={d => d.length === 0}>
          {d => <LowStockWatchlistCard items={d} />}
        </ChartSlot>
        <ChartSlot state={poTrend} empty={d => d.length === 0}>
          {d => <PoValueTrendCard data={d} />}
        </ChartSlot>
      </div>
    </div>
  )
}

function ChartSlot<T>({
  state,
  empty,
  children,
}: {
  state: CardState<T>
  empty?: (data: T) => boolean
  children: (data: T) => React.ReactNode
}) {
  if (state.status === 'loading') {
    return (
      <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 animate-fade-in">
        <div className="motion-safe:animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-surface-secondary" />
          <div className="h-40 w-full rounded bg-surface-secondary" />
        </div>
      </div>
    )
  }
  if (state.status === 'error' || state.data === undefined) return null
  if (empty && empty(state.data)) return null
  return <>{children(state.data)}</>
}
