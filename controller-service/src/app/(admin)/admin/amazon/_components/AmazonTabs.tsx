'use client'

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import PreviewApply from '@/components/admin/channels/PreviewApply'
import { TrendChart, type SeriesDef } from '@/components/admin/kit/charts'
import { ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { Badge, Empty, Kpi, KpiGrid, Section, Table, api, btnPrimary, count, inputCls, money, pct, when } from '@/components/admin/channels/ui'
import Select from '@/components/ui/Select'

const PRICE = '/api/admin/amazon/console/price'
const useCanPrice = () => useCanWrite('amazon_pricing')

export function OverviewView({ d }: { d: any }) {
  if (!d) return null
  const winRate = d.buybox.priced ? d.buybox.ours / d.buybox.priced : null
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Listings" value={count(d.listings.total)} sub={`${count(d.listings.approved)} buyable`} />
        <Kpi label="Suppressed" value={count(d.listings.suppressed)} highlight={d.listings.suppressed > 0} />
        <Kpi label="Buy Box won" value={pct(winRate, 0)} sub={`${count(d.buybox.ours)} of ${count(d.buybox.priced)} priced SKUs`} highlight />
        <Kpi label="Buy Box lost" value={count(d.buybox.lost)} />
        <Kpi label="Avg margin / unit" value={money(d.margin.average)} sub={`${count(d.margin.known)} SKUs with a cost price`} />
        <Kpi label="Selling at a loss" value={count(d.margin.negative)} highlight={d.margin.negative > 0} />
      </KpiGrid>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section title="Last listing push">
          {d.lastPush ? (
            <p className="text-sm">
              <Badge tone={d.lastPush.status === 'success' ? 'green' : d.lastPush.status === 'running' ? 'amber' : 'red'}>{d.lastPush.status}</Badge>{' '}
              <span className="text-foreground-muted text-xs">
                {count(d.lastPush.synced)} pushed, {when(d.lastPush.finished_at ?? d.lastPush.started_at)}
              </span>
            </p>
          ) : (
            <Empty msg="No push yet" />
          )}
        </Section>
        <Section title="Buy Box data">
          <p className="text-xs text-foreground-muted">Refreshed {when(d.buybox.refreshedAt)}. It refreshes every hour; the repricer runs right after.</p>
        </Section>
      </div>
    </div>
  )
}

export function SuppressedView({ d }: { d: any }) {
  return (
    <Section title="Suppressed listings">
      <p className="text-xs text-foreground-muted mb-3">Listings Amazon is not showing in search, or that have an error. Fix the issue in your catalogue, then push again from Listings.</p>
      <Table
        rows={d?.rows ?? []}
        rowKey={(r: any) => r.sku}
        empty="No suppressed listings."
        cols={[
          { key: 'sku', label: 'SKU', render: (r: any) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: 'title', label: 'Title', render: (r: any) => r.title ?? '-' },
          { key: 'state', label: 'Amazon state', render: (r: any) => (r.statuses ?? []).join(', ') || 'none' },
          {
            key: 'issues',
            label: 'Issues',
            render: (r: any) => (
              <ul className="text-xs space-y-0.5">
                {(r.issues ?? []).slice(0, 4).map((i: any, n: number) => (
                  <li key={n}>
                    <Badge tone={String(i.severity).toUpperCase() === 'ERROR' ? 'red' : 'amber'}>{i.severity}</Badge> {i.message}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </Section>
  )
}

export function BuyboxView({ d, onChanged }: { d: any; onChanged: () => void }) {
  const canPrice = useCanPrice()
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  return (
    <Section title="Buy Box and competing offers">
      <Table
        rows={d?.rows ?? []}
        rowKey={(r: any) => r.sku}
        empty="No offer data yet. Refresh the Buy Box (top right); it needs listings with an ASIN."
        cols={[
          { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.sku },
          {
            key: 'bb',
            label: 'Buy Box',
            render: (r: any) => (r.buyboxIsOurs ? <Badge tone="green">Yours</Badge> : r.buyboxIsOurs === false ? <Badge tone="red">Lost</Badge> : <Badge>-</Badge>),
            sort: (r: any) => (r.buyboxIsOurs ? 1 : 0),
          },
          { key: 'ours', label: 'Your price', num: true, render: (r: any) => money(r.ourPrice, 2), sort: (r: any) => r.ourPrice ?? 0 },
          { key: 'bbp', label: 'Buy Box price', num: true, render: (r: any) => money(r.buyboxPrice, 2), sort: (r: any) => r.buyboxPrice ?? 0 },
          { key: 'low', label: 'Lowest', num: true, render: (r: any) => money(r.lowestPrice, 2) },
          { key: 'n', label: 'Offers', num: true, render: (r: any) => r.offerCount, sort: (r: any) => r.offerCount },
          {
            key: 'margin',
            label: 'Margin now / at Buy Box',
            num: true,
            render: (r: any) => (
              <span className={r.marginAtBuybox != null && r.marginAtBuybox < 0 ? 'text-red-500' : ''}>
                {money(r.marginNow)} / {money(r.marginAtBuybox)}
              </span>
            ),
          },
          ...(canPrice
            ? [
                {
                  key: 'act',
                  label: '',
                  render: (r: any) =>
                    r.buyboxIsOurs === false && r.buyboxPrice ? (
                      <button type="button" className="text-xs text-accent-500 underline" onClick={() => setPending({ sku: r.sku, price: r.buyboxPrice })}>
                        Match Buy Box
                      </button>
                    ) : null,
                },
              ]
            : []),
        ]}
      />
      {pending && <PreviewApply writeScope="amazon_pricing:write" endpoint={PRICE} payload={pending} applyLabel="Change price" onClose={() => setPending(null)} onDone={onChanged} />}
    </Section>
  )
}

export function FeesView({ d }: { d: any }) {
  return (
    <Section title="Fees and margin per unit">
      <p className="text-xs text-foreground-muted mb-3">
        Amazon&apos;s fee estimate at the current price. Margin = price without GST − Amazon fees − your cost price. GST on Amazon fees (18%) is shown separately; GST-registered sellers claim it back as input credit.
      </p>
      <Table
        rows={d?.rows ?? []}
        rowKey={(r: any) => r.sku}
        empty="No fee estimates yet. Refresh fees (top right)."
        cols={[
          { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.sku },
          { key: 'price', label: 'Price', num: true, render: (r: any) => money(r.price, 2), sort: (r: any) => r.price },
          { key: 'ref', label: 'Referral', num: true, render: (r: any) => money(r.referral, 2) },
          { key: 'close', label: 'Closing', num: true, render: (r: any) => money(r.closing, 2) },
          { key: 'ful', label: 'Shipping / FBA', num: true, render: (r: any) => money(r.fulfillment, 2) },
          { key: 'fees', label: 'Fees', num: true, render: (r: any) => money(r.fees, 2), sort: (r: any) => r.fees },
          { key: 'gst', label: 'GST on fees', num: true, render: (r: any) => money(r.gstOnFees, 2) },
          { key: 'cost', label: 'Cost', num: true, render: (r: any) => money(r.cost, 2) },
          {
            key: 'margin',
            label: 'Margin',
            num: true,
            render: (r: any) => (r.margin == null ? <span className="text-xs text-foreground-muted">no cost price</span> : <span className={r.margin < 0 ? 'text-red-500 font-medium' : ''}>{money(r.margin, 2)} ({pct(r.marginPct, 0)})</span>),
            sort: (r: any) => r.margin ?? -1e9,
          },
        ]}
      />
    </Section>
  )
}

const STRATEGY: Record<string, string> = { match_buybox: 'Match the Buy Box', beat_buybox: 'Beat the Buy Box', hold: 'Hold my price' }

export function RepricerView({ d, onChanged }: { d: any; onChanged: () => void }) {
  const canPrice = useCanPrice()
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ sku: '', strategy: 'match_buybox', beatBy: '1', minPrice: '', maxPrice: '', minMarginPct: '5', autoApply: false })
  const toast = useActionToast()
  const saveRule = async () => {
    const r = await api('/api/admin/amazon/console/rules', {
      method: 'PUT',
      json: {
        sku: form.sku.trim() || null,
        strategy: form.strategy,
        beatBy: Number(form.beatBy || 0),
        minPrice: form.minPrice ? Number(form.minPrice) : null,
        maxPrice: form.maxPrice ? Number(form.maxPrice) : null,
        minMarginPct: Number(form.minMarginPct || 0),
        autoApply: form.autoApply,
      },
    })
    if (r.ok) onChanged()
    else toast.error(r.data.problems?.[0] || r.data.error || 'Could not save the rule')
  }
  return (
    <div className="space-y-5">
      <Section title="Suggested price changes">
        <p className="text-xs text-foreground-muted mb-3">
          From your rules and the latest Buy Box. A price never goes below the floor: your minimum price, and the lowest price that keeps your minimum margin after Amazon fees and cost.
        </p>
        <Table
          rows={d?.proposals ?? []}
          rowKey={(r: any) => r.sku}
          empty="Nothing to change: you hold the Buy Box, or there is no rule, or no Buy Box data yet."
          cols={[
            { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.sku },
            { key: 'cur', label: 'Now', num: true, render: (r: any) => money(r.current, 2) },
            { key: 'to', label: 'Suggested', num: true, render: (r: any) => money(r.target, 2) },
            { key: 'floor', label: 'Floor', num: true, render: (r: any) => money(r.floor, 2) },
            { key: 'why', label: 'Why', render: (r: any) => <span className="text-xs">{r.reason}</span> },
            { key: 'auto', label: 'Auto', render: (r: any) => (r.autoApply ? <Badge tone="blue">auto</Badge> : null) },
            ...(canPrice
              ? [
                  {
                    key: 'act',
                    label: '',
                    render: (r: any) => (
                      <button type="button" className="text-xs text-accent-500 underline" onClick={() => setPending({ sku: r.sku, price: r.target })}>
                        Apply
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>
      <Section title="Rules">
        <Table
          rows={d?.rules ?? []}
          rowKey={(r: any) => r.id}
          empty="No rules yet. Add a default rule (leave SKU empty) to cover every listing."
          cols={[
            { key: 'sku', label: 'SKU', render: (r: any) => r.sku ?? <Badge tone="blue">All SKUs</Badge> },
            { key: 'strategy', label: 'Strategy', render: (r: any) => `${STRATEGY[r.strategy]}${r.strategy === 'beat_buybox' ? ` by ${r.beatBy}` : ''}` },
            { key: 'min', label: 'Min', num: true, render: (r: any) => money(r.minPrice, 2) },
            { key: 'max', label: 'Max', num: true, render: (r: any) => money(r.maxPrice, 2) },
            { key: 'margin', label: 'Min margin', num: true, render: (r: any) => `${r.minMarginPct}%` },
            { key: 'auto', label: 'Applies', render: (r: any) => (r.autoApply ? 'Automatically, hourly' : 'When you click Apply') },
            ...(canPrice
              ? [
                  {
                    key: 'del',
                    label: '',
                    render: (r: any) => (
                      <button
                        type="button"
                        aria-label="Remove rule"
                        className="text-red-500"
                        onClick={async () => {
                          await api(`/api/admin/amazon/console/rules?id=${r.id}`, { method: 'DELETE' })
                          onChanged()
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {canPrice && (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7 items-end mt-4 rounded-lg border border-border-default p-3">
            <label className="text-xs text-foreground-muted">
              SKU (empty = all)
              <input className={inputCls} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted">
              Strategy
              <Select
                className="w-full"
                value={form.strategy}
                onChange={v => setForm(f => ({ ...f, strategy: v }))}
                options={Object.entries(STRATEGY).map(([k, v]) => ({ value: k, label: v }))}
                aria-label="Strategy"
              />
            </label>
            <label className="text-xs text-foreground-muted">
              Beat by ₹
              <input className={inputCls} type="number" min={0} value={form.beatBy} disabled={form.strategy !== 'beat_buybox'} onChange={e => setForm(f => ({ ...f, beatBy: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted">
              Min price
              <input className={inputCls} type="number" min={0} value={form.minPrice} onChange={e => setForm(f => ({ ...f, minPrice: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted">
              Max price
              <input className={inputCls} type="number" min={0} value={form.maxPrice} onChange={e => setForm(f => ({ ...f, maxPrice: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted">
              Min margin %
              <input className={inputCls} type="number" min={0} max={90} value={form.minMarginPct} onChange={e => setForm(f => ({ ...f, minMarginPct: e.target.value }))} />
            </label>
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={form.autoApply} onChange={e => setForm(f => ({ ...f, autoApply: e.target.checked }))} /> Apply automatically
            </label>
            <div className="col-span-full flex justify-end">
              <button type="button" className={btnPrimary} onClick={saveRule}>
                Save rule
              </button>
            </div>
          </div>
        )}
      </Section>
      {pending && <PreviewApply writeScope="amazon_pricing:write" endpoint={PRICE} payload={pending} applyLabel="Change price" onClose={() => setPending(null)} onDone={onChanged} />}
    </div>
  )
}

const STOCK_TONE: Record<string, 'green' | 'amber' | 'red' | 'muted' | 'blue'> = { deducted: 'green', restored: 'blue', short: 'red', unmatched: 'amber', none: 'muted' }

export function OrdersStockView({ onChanged }: { onChanged: () => void }) {
  const canWrite = useCanWrite('amazon_orders')
  const [d, setD] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const toast = useActionToast()
  const [form, setForm] = useState<{ importOrders: boolean; pushStock: boolean; buffer: number } | null>(null)
  const load = async () => {
    const r = await api('/api/admin/amazon/orders')
    if (r.ok) {
      setD(r.data)
      setForm({ importOrders: r.data.orders.enabled, pushStock: r.data.stock.settings.enabled, buffer: r.data.stock.settings.buffer })
    } else setNotice(r.data.error || 'Could not load')
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const run = async (key: string, url: string, method = 'POST', json?: unknown) => {
    setBusy(key)
    const r = await api(url, { method, json })
    setBusy(null)
    toast.result({ ok: r.ok, text: r.ok ? (r.data.status ? `Done (${r.data.status}).` : 'Saved.') : r.data.error || r.data.problems?.[0] || 'Failed' })
    await load()
    onChanged()
  }
  if (!d || !form) return notice ? <ErrorState body={notice} /> : <p className="text-sm text-foreground-muted">Loading...</p>
  const s = d.orders.summary ?? {}
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Amazon orders, 30 days" value={count(Number(s.orders_30d ?? 0))} />
        <Kpi label="Amazon sales, 30 days" value={money(Number(s.revenue_30d ?? 0))} highlight />
        <Kpi label="Need attention" value={count(Number(s.needs_attention ?? 0))} sub="short on stock or SKU not matched" />
      </KpiGrid>
      <Section title="Settings">
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" disabled={!canWrite} checked={form.importOrders} onChange={e => setForm(f => ({ ...f!, importOrders: e.target.checked }))} />
            <span>
              Import Amazon orders into Orders every 15 minutes. Orders you ship yourself take stock when Amazon confirms them and give it back if they are cancelled; orders fulfilled by Amazon (FBA) never touch your stock.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" disabled={!canWrite} checked={form.pushStock} onChange={e => setForm(f => ({ ...f!, pushStock: e.target.checked }))} />
            <span>Keep Amazon&apos;s stock in step with yours (for products that track stock), every 15 minutes, only when it changes.</span>
          </label>
          <label className="block">
            <span className="text-xs text-foreground-muted">Safety buffer</span>
            <input className={`${inputCls} w-24`} type="number" min={0} max={1000} disabled={!canWrite} value={form.buffer} onChange={e => setForm(f => ({ ...f!, buffer: Number(e.target.value) }))} />
            <span className="block text-xs text-foreground-muted">units held back from Amazon per SKU</span>
          </label>
          {d.stock.pushDisabled && <p className="text-xs text-amber-600">Pushing to Amazon is turned off in this environment, so stock is calculated but not sent.</p>}
          {canWrite && (
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" className={btnPrimary} disabled={busy === 'save'} onClick={() => run('save', '/api/admin/amazon/orders-settings', 'PUT', form)}>
                Save settings
              </button>
              <button type="button" className={btnPrimary} disabled={busy === 'import' || !d.orders.enabled} onClick={() => run('import', '/api/admin/amazon/orders/import')}>
                Import orders now
              </button>
              <button type="button" className={btnPrimary} disabled={busy === 'push' || !d.stock.settings.enabled} onClick={() => run('push', '/api/admin/amazon/stock/push')}>
                Push stock now
              </button>
            </div>
          )}
        </div>
      </Section>
      <Section title="Amazon orders">
        <Table
          rows={d.orders.rows}
          rowKey={(r: any) => r.amazon_order_id}
          empty="No Amazon orders imported yet."
          cols={[
            { key: 'when', label: 'Placed', render: (r: any) => <span className="whitespace-nowrap">{when(r.purchase_date)}</span>, sort: (r: any) => r.purchase_date ?? '' },
            { key: 'id', label: 'Amazon order', render: (r: any) => <span className="font-mono text-xs">{r.amazon_order_id}</span> },
            { key: 'ours', label: 'Our order', render: (r: any) => (r.order_id ? <a className="text-xs underline" href={ap(`/admin/orders/${r.order_id}`)}>{r.order_number}</a> : '-') },
            { key: 'status', label: 'Amazon status', render: (r: any) => r.status },
            { key: 'ch', label: 'Fulfilled by', render: (r: any) => (r.fulfillment_channel === 'AFN' ? <Badge tone="blue">Amazon</Badge> : <Badge>You</Badge>) },
            { key: 'total', label: 'Total', num: true, render: (r: any) => money(Number(r.order_total ?? 0), 2) },
            {
              key: 'items',
              label: 'Items',
              render: (r: any) => (
                <span className="text-xs">
                  {(r.items ?? []).map((i: any) => `${i.qty} x ${i.sku ?? i.title}${i.matched ? '' : ' (no match)'}`).join(', ')}
                </span>
              ),
            },
            {
              key: 'stock',
              label: 'Stock',
              render: (r: any) => (
                <span title={r.stock_note ?? undefined}>
                  <Badge tone={STOCK_TONE[r.stock_state] ?? 'muted'}>{r.stock_state}</Badge>
                </span>
              ),
            },
          ]}
        />
      </Section>
      <Section title="Stock on Amazon">
        <Table
          rows={d.stock.rows}
          rowKey={(r: any) => r.sku}
          empty="Nothing tracked yet. Turn on stock push; only products that track stock and that you ship yourself are included."
          cols={[
            { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.sku },
            { key: 'ours', label: 'Your stock', num: true, render: (r: any) => (r.our_available == null ? '-' : Number(r.our_available)) },
            { key: 'res', label: 'Held for Amazon', num: true, render: (r: any) => r.reserved },
            { key: 'pushed', label: 'Sent to Amazon', num: true, render: (r: any) => r.pushed_qty ?? '-' },
            { key: 'amz', label: 'Amazon shows', num: true, render: (r: any) => r.amazon_quantity ?? '-' },
            { key: 'at', label: 'Sent', render: (r: any) => when(r.pushed_at) },
            { key: 'err', label: '', render: (r: any) => (r.push_error ? <span className="text-xs text-red-500">{r.push_error}</span> : null) },
          ]}
        />
      </Section>
    </div>
  )
}

const SALES_SERIES: SeriesDef[] = [
  { key: 'sales', label: 'Ordered sales', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
  { key: 'sessions', label: 'Sessions', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'units', label: 'Units', color: 'rgb(168 85 247)', kind: 'line', axis: 'count', on: false },
]

export function SalesView({ d }: { d: any }) {
  if (!d) return null
  const days = d.daily ?? []
  const sum = (k: string) => days.reduce((s: number, x: any) => s + Number(x[k] ?? 0), 0)
  const sessions = sum('sessions')
  const units = sum('units_ordered')
  const p = d.profit
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Ordered sales" value={money(sum('ordered_sales'))} sub="last 45 days, Amazon's report" highlight />
        <Kpi label="Units" value={count(units)} />
        <Kpi label="Sessions" value={count(sessions)} />
        <Kpi label="Conversion" value={pct(sessions ? units / sessions : null)} sub="units per session" />
        <Kpi label="Est. profit, 30 days" value={money(p.profit)} sub={`sales ex GST ${money(p.revenue)} − cost ${money(p.cost)} − fees ${money(p.fees)}`} />
        <Kpi label="Lines without cost" value={count(p.linesWithoutCost)} sub={`of ${count(p.lines)} order lines; add cost prices for a true profit`} />
      </KpiGrid>
      <Section title="Sales and traffic by day">
        {days.length ? (
          <TrendChart points={days.map((x: any) => ({ label: String(x.date).slice(0, 10), sales: Number(x.ordered_sales), sessions: Number(x.sessions), units: Number(x.units_ordered) }))} series={SALES_SERIES} ariaLabel="Amazon sales and sessions by day" />
        ) : (
          <Empty msg="No report yet. Amazon builds it in a few minutes after it is requested; reports refresh every 6 hours." />
        )}
      </Section>
      <Section title="By product (child ASIN)">
        <Table
          rows={d.asins ?? []}
          rowKey={(r: any) => r.asin}
          empty="No product breakdown yet."
          cols={[
            { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.sku ?? r.asin },
            { key: 'sales', label: 'Sales', num: true, render: (r: any) => money(Number(r.ordered_sales)), sort: (r: any) => Number(r.ordered_sales) },
            { key: 'units', label: 'Units', num: true, render: (r: any) => count(r.units_ordered), sort: (r: any) => r.units_ordered },
            { key: 'sessions', label: 'Sessions', num: true, render: (r: any) => count(r.sessions), sort: (r: any) => r.sessions },
            { key: 'conv', label: 'Unit session %', num: true, render: (r: any) => (r.unit_session_pct == null ? '-' : `${Number(r.unit_session_pct).toFixed(1)}%`) },
            { key: 'bb', label: 'Buy Box %', num: true, render: (r: any) => (r.buy_box_pct == null ? '-' : `${Number(r.buy_box_pct).toFixed(0)}%`) },
          ]}
        />
      </Section>
      <Section title="Settlements (payouts)">
        <Table
          rows={d.settlements ?? []}
          rowKey={(r: any) => r.settlement_id}
          empty="No settlements yet. Amazon creates one per payout."
          cols={[
            { key: 'period', label: 'Period', render: (r: any) => `${String(r.start_date ?? '').slice(0, 10)} to ${String(r.end_date ?? '').slice(0, 10)}` },
            { key: 'deposit', label: 'Paid', render: (r: any) => String(r.deposit_date ?? '-').slice(0, 10) },
            { key: 'sales', label: 'Sales', num: true, render: (r: any) => money(Number(r.product_sales), 2) },
            { key: 'fees', label: 'Fees', num: true, render: (r: any) => money(Number(r.fees), 2) },
            { key: 'refunds', label: 'Refunds', num: true, render: (r: any) => money(Number(r.refunds), 2) },
            { key: 'tax', label: 'TCS / TDS', num: true, render: (r: any) => money(Number(r.tax_withheld), 2) },
            { key: 'total', label: 'Payout', num: true, render: (r: any) => <strong>{money(Number(r.total_amount), 2)}</strong> },
          ]}
        />
      </Section>
    </div>
  )
}
