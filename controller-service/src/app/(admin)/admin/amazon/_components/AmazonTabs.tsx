'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import PreviewApply from '@/components/admin/channels/PreviewApply'
import { Badge, Empty, Kpi, KpiGrid, Section, Table, api, btnPrimary, count, inputCls, money, pct, when } from '@/components/admin/channels/ui'

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
      <div className="grid gap-5 md:grid-cols-2">
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
  const [notice, setNotice] = useState<string | null>(null)
  const saveRule = async () => {
    setNotice(null)
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
    else setNotice(r.data.problems?.[0] || r.data.error || 'Could not save the rule')
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
          <div className="grid gap-2 md:grid-cols-7 items-end mt-4 rounded-lg border border-border-default p-3">
            <label className="text-xs text-foreground-muted">
              SKU (empty = all)
              <input className={inputCls} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
            </label>
            <label className="text-xs text-foreground-muted">
              Strategy
              <select className={inputCls} value={form.strategy} onChange={e => setForm(f => ({ ...f, strategy: e.target.value }))}>
                {Object.entries(STRATEGY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
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
            <div className="flex flex-col gap-2">
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" checked={form.autoApply} onChange={e => setForm(f => ({ ...f, autoApply: e.target.checked }))} /> Apply automatically
              </label>
              <button type="button" className={btnPrimary} onClick={saveRule}>
                Save rule
              </button>
            </div>
            {notice && <p className="text-xs text-red-500 md:col-span-7">{notice}</p>}
          </div>
        )}
      </Section>
      {pending && <PreviewApply writeScope="amazon_pricing:write" endpoint={PRICE} payload={pending} applyLabel="Change price" onClose={() => setPending(null)} onDone={onChanged} />}
    </div>
  )
}
