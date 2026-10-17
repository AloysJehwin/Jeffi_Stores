'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowRight, CircleAlert, Info, RefreshCw } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import {
  Badge,
  Banner,
  Kpi,
  KpiGrid,
  Section,
  Table,
  api,
  change,
  count,
  money,
  type Col,
  type Tone,
} from '@/components/admin/channels/ui'
import {
  MovementTrendCard,
  PoValueTrendCard,
  StockValueDonutCard,
  TopStockValueCard,
  type DonutSegment,
  type RankedItem,
} from './InventoryOverviewCharts'
import {
  PRESETS,
  formatRange,
  istToday,
  matchPreset,
  presetRange,
  rangeFromParams,
  type Range,
} from './inventoryOverviewPeriod'

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

interface Leaf {
  product_id: string
  variant_id: string | null
  sub_variant_id: string | null
  name: string
  leaf_name: string | null
  sku: string | null
  qty: number
}
type ValueLeaf = Leaf & { value: number }
type ReorderRow = Leaf & {
  sold: number
  unit_cost: number
  supplier_id: string | null
  supplier_name: string | null
  avgDaily: number
  daysOfCover: number
  thresholdDays: number
  leadTimeDays: number | null
  suggestedQty: number
}
interface OverduePo {
  id: string
  po_number: string
  status: string
  expected_date: string
  total_amount: number
  days_late: number
  supplier_name: string | null
}
interface Batch {
  id: string
  product_id: string
  name: string
  leaf_name: string | null
  lot_number: string | null
  expiry_date: string
  qty: number
  days_left: number
  value: number
}
interface Movement {
  key: string
  created_at: string
  transaction_type: string
  quantity_change: number
  rows: number
  reference_type: string | null
  reference_label: string | null
  unit_label: string | null
  product_id: string
  name: string
  leaf_name: string | null
}
interface Overview {
  period: { from: string; to: string; prevFrom: string; prevTo: string; days: number; today: string }
  stock: {
    skus: number
    inStock: number
    low: number
    out: number
    negative: number
    units: number
    valueCost: number
    valueRetail: number
    valueEstimated: number
    noCost: number
    deadCount: number
    deadValue: number
  }
  sales: {
    units: number
    unitsPrev: number
    cogs: number
    cogsPrev: number
    turnover: number | null
    turnoverPrev: number | null
    annualTurnover: number | null
    daysOfCover: number | null
  }
  movements: {
    in: number
    out: number
    inPrev: number
    outPrev: number
    events: number
    eventsPrev: number
    byType: { type: string; in: number; out: number; rows: number }[]
    daily: { day: string; in: number; out: number }[]
  }
  po: {
    openCount: number
    openValue: number
    draftCount: number
    overdueCount: number
    overdueValue: number
    orderedValue: number
    orderedValuePrev: number
    orderedCount: number
    orderedCountPrev: number
    activeSuppliers: number
    overdue: OverduePo[]
    trend: { month: string; value: number }[]
  }
  byCategory: { label: string; value: number }[]
  topSkus: (ValueLeaf & { unit_cost: number; has_cost: boolean })[]
  reorder: ReorderRow[]
  sellingOut: (Leaf & { sold: number })[]
  negative: Leaf[]
  noCost: ValueLeaf[]
  dead: (ValueLeaf & { last_sale: string | null })[]
  expiring: Batch[]
  recent: Movement[]
}

const label = (r: { name: string; leaf_name: string | null }) => (r.leaf_name ? `${r.name} — ${r.leaf_name}` : r.name)
const qtyFmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 3 })
const dateFmt = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

// Inventory tabs read their state once on mount, so tab links use a full navigation.
const invHref = (q: string) => `${ap('/admin/inventory')}?${q}`
const poHref = (q: string) => `${ap('/admin/purchase-orders')}?${q}`
const valuationHref = (search?: string | null, stock?: string) =>
  invHref(
    new URLSearchParams({
      tab: 'valuation',
      ...(search ? { val_search: search } : {}),
      ...(stock ? { val_stock: stock } : {}),
    }).toString()
  )
const newPoHref = (r: { product_id: string; variant_id: string | null }) =>
  ap(`/admin/purchase-orders/new?product=${r.product_id}${r.variant_id ? `&variant=${r.variant_id}` : ''}`)

function buildCategorySegments(rows: { label: string; value: number }[]): DonutSegment[] {
  const top = rows.slice(0, CATEGORY_PALETTE.length)
  const restTotal = rows.slice(CATEGORY_PALETTE.length).reduce((s, r) => s + r.value, 0)
  const segs: DonutSegment[] = top.map((r, i) => ({ label: r.label, value: r.value, color: CATEGORY_PALETTE[i] }))
  if (restTotal > 0) segs.push({ label: 'Other', value: restTotal, color: OTHER_COLOR })
  return segs
}

const TYPE_LABEL: Record<string, string> = {
  purchase: 'Received (GRN)',
  sale: 'Sold',
  return: 'Returned',
  adjustment: 'Adjustment',
}
const TYPE_TONE: Record<string, Tone> = { purchase: 'green', sale: 'blue', return: 'amber', adjustment: 'muted' }

function PeriodPicker({ value, today, onChange }: { value: Range; today: string; onChange: (r: Range) => void }) {
  const active = matchPreset(value, today)
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
      <div className="flex gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg overflow-x-auto max-w-full">
        {PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(presetRange(p.id, today))}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              active === p.id ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-foreground-secondary">{formatRange(value)}</p>
    </div>
  )
}

interface AttentionItem {
  key: string
  tone: 'red' | 'amber' | 'muted'
  title: string
  detail?: string
  href: string
  external?: boolean
  cta: string
  items?: { key: string; text: string; href?: string; external?: boolean; meta?: string }[]
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  if (!items.length) return <Banner ok>Nothing needs attention right now.</Banner>
  return (
    <ul className="divide-y divide-border-default/60">
      {items.map(it => {
        const Icon = it.tone === 'red' ? CircleAlert : it.tone === 'amber' ? AlertTriangle : Info
        const iconCls =
          it.tone === 'red'
            ? 'text-red-500'
            : it.tone === 'amber'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-foreground-muted'
        const cta = (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-500 hover:underline whitespace-nowrap">
            {it.cta} <ArrowRight className="w-3 h-3" />
          </span>
        )
        return (
          <li key={it.key} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconCls}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm font-medium text-foreground">{it.title}</p>
                  {it.external ? <a href={it.href}>{cta}</a> : <Link href={it.href}>{cta}</Link>}
                </div>
                {it.detail && <p className="text-xs text-foreground-secondary mt-0.5">{it.detail}</p>}
                {it.items && it.items.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {it.items.map(x => (
                      <li key={x.key} className="text-xs text-foreground-secondary flex flex-wrap gap-x-2">
                        {x.href ? (
                          x.external ? (
                            <a href={x.href} className="hover:text-foreground hover:underline truncate max-w-full">
                              {x.text}
                            </a>
                          ) : (
                            <Link href={x.href} className="hover:text-foreground hover:underline truncate max-w-full">
                              {x.text}
                            </Link>
                          )
                        ) : (
                          <span className="truncate max-w-full">{x.text}</span>
                        )}
                        {x.meta && <span className="text-foreground-muted">{x.meta}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function buildAttention(d: Overview): AttentionItem[] {
  const out: AttentionItem[] = []
  if (d.sellingOut.length)
    out.push({
      key: 'selling-out',
      tone: 'red',
      title: `${d.sellingOut.length}${d.sellingOut.length >= 20 ? '+' : ''} SKUs are out of stock but sold in this period`,
      detail: 'Lost sales until restocked. Raise a purchase order.',
      href: valuationHref(null, 'out_of_stock'),
      external: true,
      cta: 'Out-of-stock list',
      items: d.sellingOut.slice(0, 5).map(r => ({
        key: `${r.product_id}:${r.variant_id}:${r.sub_variant_id}`,
        text: label(r),
        href: newPoHref(r),
        meta: `${qtyFmt(r.sold)} sold, ${qtyFmt(r.qty)} on hand`,
      })),
    })
  if (d.po.overdueCount)
    out.push({
      key: 'overdue-po',
      tone: 'red',
      title: `${d.po.overdueCount} purchase orders are past their expected date`,
      detail: `${money(d.po.overdueValue)} not yet fully received. Follow up with the supplier or receive the goods.`,
      href: poHref('tab=orders'),
      external: true,
      cta: 'Purchase orders',
      items: d.po.overdue.slice(0, 5).map(p => ({
        key: p.id,
        text: `${p.po_number}${p.supplier_name ? ` · ${p.supplier_name}` : ''}`,
        href: poHref(`tab=orders&po=${p.id}`),
        external: true,
        meta: `${p.days_late} days late, ${money(p.total_amount)}`,
      })),
    })
  if (d.stock.negative)
    out.push({
      key: 'negative',
      tone: 'red',
      title: `${d.stock.negative} SKUs show negative stock`,
      detail: 'More was sold than recorded on hand. Count the shelf and adjust, or receive the pending GRN.',
      href: invHref('tab=ledger'),
      external: true,
      cta: 'Stock ledger',
      items: d.negative.slice(0, 5).map(r => ({
        key: `${r.product_id}:${r.variant_id}:${r.sub_variant_id}`,
        text: label(r),
        href: valuationHref(r.sku || r.name),
        external: true,
        meta: `${qtyFmt(r.qty)} on hand`,
      })),
    })
  if (d.stock.noCost)
    out.push({
      key: 'no-cost',
      tone: 'amber',
      title: `${d.stock.noCost} SKUs in stock have no cost price`,
      detail: `Valued at the ex-GST selling price instead (${money(d.stock.valueEstimated)} of stock value), which overstates value and hides margin. Set a cost price on the product.`,
      href: valuationHref(),
      external: true,
      cta: 'Valuation',
      items: d.noCost.slice(0, 5).map(r => ({
        key: `${r.product_id}:${r.variant_id}:${r.sub_variant_id}`,
        text: label(r),
        href: ap(`/admin/products/${r.product_id}/edit`),
        meta: `${qtyFmt(r.qty)} on hand`,
      })),
    })
  const expired = d.expiring.filter(b => b.days_left < 0)
  const soon = d.expiring.filter(b => b.days_left >= 0)
  if (d.expiring.length)
    out.push({
      key: 'expiring',
      tone: expired.length ? 'red' : 'amber',
      title: [
        expired.length && `${expired.length} batches expired`,
        soon.length && `${soon.length} expire within 30 days`,
      ]
        .filter(Boolean)
        .join(', '),
      detail: `${money(d.expiring.reduce((s, b) => s + b.value, 0))} at cost. Sell first, return to supplier or write off.`,
      href: '#expiring',
      external: true,
      cta: 'Expiring batches',
    })
  if (d.reorder.length)
    out.push({
      key: 'reorder',
      tone: 'amber',
      title: `${d.reorder.length} SKUs will run out before a new order can arrive`,
      detail: 'Days of cover is below the supplier lead time or 14 days. See reorder suggestions below.',
      href: '#reorder',
      external: true,
      cta: 'Reorder suggestions',
    })
  if (d.po.draftCount)
    out.push({
      key: 'draft-po',
      tone: 'muted',
      title: `${d.po.draftCount} draft purchase orders not sent`,
      href: poHref('tab=orders'),
      external: true,
      cta: 'Purchase orders',
    })
  if (d.stock.deadCount)
    out.push({
      key: 'dead',
      tone: 'muted',
      title: `${d.stock.deadCount} SKUs have not sold in 90 days`,
      detail: `${money(d.stock.deadValue)} tied up. Consider a discount, bundle or supplier return.`,
      href: '#dead-stock',
      external: true,
      cta: 'Dead stock',
    })
  return out
}

export default function InventoryOverviewTab() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const canWrite = useCanWrite('inventory')
  const today = useMemo(() => istToday(), [])
  const range = useMemo(
    () => rangeFromParams(searchParams.get('from'), searchParams.get('to'), today),
    [searchParams, today]
  )
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const { ok, data: body } = await api<Overview>(`/api/admin/inventory/overview?from=${range.from}&to=${range.to}`)
      if (id !== reqId.current) return
      if (!ok) throw new Error(body?.error || 'Could not load the overview')
      setData(body)
    } catch (e: any) {
      if (id === reqId.current) setError(e?.message || 'Could not load the overview')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  function setRange(r: Range) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'overview')
    params.set('from', r.from)
    params.set('to', r.to)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const attention = useMemo(() => (data ? buildAttention(data) : []), [data])
  const segments = useMemo(() => (data ? buildCategorySegments(data.byCategory) : []), [data])
  const topSkus: RankedItem[] = useMemo(
    () =>
      (data?.topSkus ?? []).map(r => ({
        name: label(r),
        value: r.value,
        sub: `${money(r.value)} · ${qtyFmt(r.qty)} on hand${r.has_cost ? '' : ' · no cost price'}`,
      })),
    [data]
  )

  const reorderCols: Col<ReorderRow>[] = [
    {
      key: 'sku',
      label: 'SKU',
      render: r => (
        <div className="min-w-[10rem]">
          <p className="text-foreground">{label(r)}</p>
          {r.sku && <p className="text-xs text-foreground-muted">{r.sku}</p>}
        </div>
      ),
      sort: r => r.name,
    },
    { key: 'qty', label: 'On hand', num: true, render: r => qtyFmt(r.qty), sort: r => r.qty },
    {
      key: 'daily',
      label: 'Sold / day',
      num: true,
      render: r => r.avgDaily.toFixed(r.avgDaily < 10 ? 2 : 0),
      sort: r => r.avgDaily,
    },
    {
      key: 'cover',
      label: 'Days of cover',
      num: true,
      render: r => (
        <Badge tone={r.daysOfCover < 7 ? 'red' : 'amber'}>
          {r.daysOfCover < 1 ? '< 1' : Math.floor(r.daysOfCover)} days
        </Badge>
      ),
      sort: r => r.daysOfCover,
    },
    {
      key: 'lead',
      label: 'Lead time',
      num: true,
      render: r => (r.leadTimeDays == null ? '-' : `${r.leadTimeDays} days`),
      sort: r => r.leadTimeDays ?? -1,
    },
    {
      key: 'suggest',
      label: 'Reorder qty',
      num: true,
      render: r => <span className="font-semibold">{qtyFmt(r.suggestedQty)}</span>,
      sort: r => r.suggestedQty,
    },
    {
      key: 'cost',
      label: 'Est. cost',
      num: true,
      render: r => money(r.suggestedQty * r.unit_cost),
      sort: r => r.suggestedQty * r.unit_cost,
    },
    {
      key: 'supplier',
      label: 'Supplier',
      render: r => r.supplier_name || <span className="text-foreground-muted">Not set</span>,
      sort: r => r.supplier_name || '',
    },
    ...(canWrite
      ? [
          {
            key: 'act',
            label: '',
            render: (r: ReorderRow) => (
              <Link
                href={newPoHref(r)}
                className="text-xs font-medium text-accent-500 hover:underline whitespace-nowrap"
              >
                Create PO
              </Link>
            ),
          },
        ]
      : []),
  ]

  const deadCols: Col<Overview['dead'][number]>[] = [
    { key: 'sku', label: 'SKU', render: r => <span className="text-foreground">{label(r)}</span>, sort: r => r.name },
    { key: 'qty', label: 'On hand', num: true, render: r => qtyFmt(r.qty), sort: r => r.qty },
    { key: 'value', label: 'Value at cost', num: true, render: r => money(r.value), sort: r => r.value },
    {
      key: 'last',
      label: 'Last sale',
      render: r => (r.last_sale ? dateFmt(r.last_sale) : <span className="text-foreground-muted">Over 90 days</span>),
    },
  ]

  const batchCols: Col<Batch>[] = [
    {
      key: 'sku',
      label: 'Batch',
      render: r => (
        <div>
          <p className="text-foreground">{label(r)}</p>
          {r.lot_number && <p className="text-xs text-foreground-muted">Lot {r.lot_number}</p>}
        </div>
      ),
      sort: r => r.name,
    },
    { key: 'qty', label: 'Qty', num: true, render: r => qtyFmt(r.qty), sort: r => r.qty },
    {
      key: 'exp',
      label: 'Expiry',
      render: r => (
        <span className="whitespace-nowrap">
          {dateFmt(r.expiry_date)}{' '}
          <Badge tone={r.days_left < 0 ? 'red' : r.days_left <= 7 ? 'amber' : 'muted'}>
            {r.days_left < 0 ? 'Expired' : `${r.days_left} days`}
          </Badge>
        </span>
      ),
      sort: r => r.days_left,
    },
    { key: 'value', label: 'Value', num: true, render: r => money(r.value), sort: r => r.value },
  ]

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <PeriodPicker value={range} today={today} onChange={setRange} />
        <AdminStatsSkeleton cards={6} gridClass="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
        <AdminStatsSkeleton cards={6} gridClass="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <PeriodPicker value={range} today={today} onChange={setRange} />
        <Banner ok={false}>
          {error || 'Could not load the overview'}{' '}
          <button type="button" onClick={load} className="underline">
            Try again
          </button>
        </Banner>
      </div>
    )
  }

  const { stock, sales, movements: mv, po } = data
  const days = data.period.days

  return (
    <div className={`space-y-5 ${loading ? 'opacity-70 transition-opacity' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <PeriodPicker value={range} today={today} onChange={setRange} />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Refresh"
          aria-label="Refresh"
          className="p-2 rounded-lg border border-border-default text-foreground-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <Banner ok={false}>{error}</Banner>}

      <Section title="Needs attention">
        <AttentionList items={attention} />
      </Section>

      <div className="space-y-3">
        <KpiGrid>
          <Kpi
            label="Stock value at cost"
            value={money(stock.valueCost)}
            highlight
            sub={
              stock.noCost
                ? `${money(stock.valueEstimated)} estimated (no cost price)`
                : `${count(stock.inStock)} SKUs in stock`
            }
          />
          <Kpi
            label="At selling price"
            value={money(stock.valueRetail)}
            sub={
              stock.valueCost > 0
                ? `${((stock.valueRetail / stock.valueCost - 1) * 100).toFixed(0)}% over cost`
                : undefined
            }
          />
          <Kpi label="Units on hand" value={qtyFmt(stock.units)} sub={`Across ${count(stock.inStock)} SKUs`} />
          <Kpi
            label="SKUs low / out"
            value={`${count(stock.low)} / ${count(stock.out)}`}
            sub={`${count(stock.inStock)} in stock of ${count(stock.skus)}`}
          />
          <Kpi label="Open POs" value={count(po.openCount)} sub={`${money(po.openValue)} on order`} />
          <Kpi
            label="Overdue POs"
            value={count(po.overdueCount)}
            sub={po.overdueCount ? `${money(po.overdueValue)} late` : 'All on schedule'}
          />
        </KpiGrid>
        <KpiGrid>
          <Kpi
            label="Units sold"
            value={qtyFmt(sales.units)}
            delta={change(sales.units, sales.unitsPrev)}
            sub="Net of returns"
          />
          <Kpi label="Cost of goods sold" value={money(sales.cogs)} delta={change(sales.cogs, sales.cogsPrev)} />
          <Kpi
            label="Inventory turnover"
            value={sales.turnover == null ? '-' : `${sales.turnover.toFixed(2)}x`}
            delta={
              sales.turnover != null && sales.turnoverPrev != null ? change(sales.turnover, sales.turnoverPrev) : null
            }
            sub={sales.annualTurnover == null ? undefined : `${sales.annualTurnover.toFixed(1)}x a year at this pace`}
          />
          <Kpi
            label="Days of cover"
            value={sales.daysOfCover == null ? '-' : `${Math.round(sales.daysOfCover).toLocaleString('en-IN')} days`}
            sub={sales.daysOfCover == null ? 'No sales in this period' : 'Stock value / daily cost of sales'}
          />
          <Kpi
            label="Units in"
            value={qtyFmt(mv.in)}
            delta={change(mv.in, mv.inPrev)}
            sub="GRNs, returns, adjustments"
          />
          <Kpi
            label="Units out"
            value={qtyFmt(mv.out)}
            delta={change(mv.out, mv.outPrev)}
            sub={`${count(mv.events)} ledger entries`}
          />
        </KpiGrid>
      </div>

      <div id="reorder" className="scroll-mt-20">
        <Section
          title="Reorder suggestions"
          action={
            <span className="text-xs text-foreground-muted">
              Cover below lead time or 14 days, at the {days}-day sales pace
            </span>
          }
        >
          <Table
            rows={data.reorder}
            cols={reorderCols}
            rowKey={r => `${r.product_id}:${r.variant_id}:${r.sub_variant_id}`}
            empty="No SKU is selling faster than its stock can last. Nothing to reorder."
            pageSize={10}
          />
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {segments.length ? (
          <StockValueDonutCard segments={segments} total={money(stock.valueCost)} />
        ) : (
          <Section title="Stock value by category">
            <p className="text-sm text-foreground-muted text-center py-8">No stock on hand.</p>
          </Section>
        )}
        {topSkus.length ? (
          <TopStockValueCard items={topSkus} />
        ) : (
          <Section title="Top SKUs by stock value">
            <p className="text-sm text-foreground-muted text-center py-8">No stock on hand.</p>
          </Section>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <MovementTrendCard data={mv.daily} hint="Units per day" />
          {mv.byType.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {mv.byType.map(t => (
                <span key={t.type} className="inline-flex items-center gap-1.5 text-xs text-foreground-secondary">
                  <Badge tone={TYPE_TONE[t.type] || 'muted'}>{TYPE_LABEL[t.type] || t.type}</Badge>
                  {t.in ? `+${qtyFmt(t.in)}` : ''}
                  {t.in && t.out ? ' / ' : ''}
                  {t.out ? `-${qtyFmt(t.out)}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {po.trend.length ? (
            <PoValueTrendCard data={po.trend} />
          ) : (
            <Section title="Purchase order value trend">
              <p className="text-sm text-foreground-muted text-center py-8">
                No purchase orders in the last 12 months.
              </p>
            </Section>
          )}
          <p className="text-xs text-foreground-secondary">
            {count(po.orderedCount)} POs worth {money(po.orderedValue)} raised in this period
            {po.orderedValuePrev ? ` (${money(po.orderedValuePrev)} in the previous period)` : ''} ·{' '}
            {count(po.activeSuppliers)} active suppliers
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="dead-stock" className="scroll-mt-20">
          <Section
            title="Dead stock"
            action={
              stock.deadCount ? (
                <span className="text-xs text-foreground-muted">
                  {count(stock.deadCount)} SKUs · {money(stock.deadValue)} tied up
                </span>
              ) : undefined
            }
          >
            <Table
              rows={data.dead}
              cols={deadCols}
              rowKey={r => `${r.product_id}:${r.variant_id}:${r.sub_variant_id}`}
              empty="Every SKU in stock has sold in the last 90 days."
              pageSize={8}
            />
          </Section>
        </div>
        <div id="expiring" className="scroll-mt-20">
          <Section
            title="Expiring soon"
            action={<span className="text-xs text-foreground-muted">Perishable batches, next 30 days</span>}
          >
            <Table
              rows={data.expiring}
              cols={batchCols}
              rowKey={r => r.id}
              empty="No batch expires in the next 30 days."
              pageSize={8}
            />
          </Section>
        </div>
      </div>

      <Section
        title="Recent stock movements"
        action={
          <a
            href={invHref('tab=ledger')}
            className="text-xs font-medium text-accent-500 hover:underline"
          >
            Full ledger
          </a>
        }
      >
        {data.recent.length ? (
          <ul className="divide-y divide-border-default/60">
            {data.recent.map(m => (
              <li key={m.key} className="py-2 flex items-center gap-3 text-sm">
                <Badge tone={TYPE_TONE[m.transaction_type] || 'muted'}>
                  {TYPE_LABEL[m.transaction_type] || m.transaction_type}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate">{label(m)}</p>
                  <p className="text-xs text-foreground-muted">
                    {when(m.created_at)}
                    {m.reference_label ? ` · ${m.reference_label}` : ''}
                    {m.rows > 1 ? ` · ${m.rows} entries` : ''}
                  </p>
                </div>
                <span
                  className={`tabular-nums font-medium whitespace-nowrap ${
                    m.quantity_change >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'
                  }`}
                >
                  {m.quantity_change > 0 ? '+' : ''}
                  {qtyFmt(m.quantity_change)}
                  {m.unit_label ? ` ${m.unit_label}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-foreground-muted text-center py-8">No stock movements yet.</p>
        )}
      </Section>
    </div>
  )
}
