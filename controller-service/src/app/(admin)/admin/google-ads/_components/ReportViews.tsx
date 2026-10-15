'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react'
import { TrendChart, DonutSplit, RankedBars, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { money, count, decimal, pct, ratio, change, humanize } from '@/lib/google-ads/format'
import type { OverviewData, Kpis, ProductRow } from '@/lib/google-ads/report'

// One component per console tab. Data shapes come from lib/google-ads/report.ts loaders.

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

export function Empty({ msg = 'No data in this range' }: { msg?: string }) {
  return <p className="text-sm text-foreground-muted text-center py-8">{msg}</p>
}

function Kpi({
  label,
  value,
  delta,
  invert,
  sub,
  highlight,
}: {
  label: string
  value: string
  delta?: number | null
  /** Lower is better (cost, CPC). */
  invert?: boolean
  sub?: string
  highlight?: boolean
}) {
  const good = delta == null ? null : invert ? delta < 0 : delta > 0
  return (
    <div
      className={`bg-surface-elevated border rounded-xl p-4 flex flex-col gap-1 ${highlight ? 'border-accent-500/50' : 'border-border-default'}`}
    >
      <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${highlight ? 'text-accent-500' : 'text-foreground'}`}>{value}</p>
      {delta != null && (
        <p className={`text-xs flex items-center gap-1 ${good ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
          {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {(delta * 100).toFixed(1)}% vs previous
        </p>
      )}
      {sub && <p className="text-xs text-foreground-muted">{sub}</p>}
    </div>
  )
}

const Badge = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'red' | 'amber' | 'green' | 'muted' }) => {
  const cls = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    green: 'bg-green-500/10 text-green-700 dark:text-green-400',
    muted: 'bg-surface-secondary text-foreground-muted',
  }[tone]
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

const statusTone = (s: string | null | undefined): 'green' | 'amber' | 'red' | 'muted' =>
  s === 'ENABLED' || s === 'APPROVED' ? 'green' : s === 'PAUSED' || s === 'APPROVED_LIMITED' ? 'amber' : s === 'DISAPPROVED' ? 'red' : 'muted'

interface Col<T> {
  key: string
  label: string
  render: (r: T) => React.ReactNode
  sort?: (r: T) => number | string
  num?: boolean
}

const PAGE = 25

export function Table<T>({ rows, cols, rowKey, empty }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; empty?: string }) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [desc, setDesc] = useState(true)
  const [page, setPage] = useState(1)
  const sorted = useMemo(() => {
    const c = cols.find(c => c.key === sortKey)
    if (!c?.sort) return rows
    const s = [...rows].sort((a, b) => {
      const x = c.sort!(a)
      const y = c.sort!(b)
      return x < y ? -1 : x > y ? 1 : 0
    })
    return desc ? s.reverse() : s
  }, [rows, cols, sortKey, desc])
  if (!rows.length) return <Empty msg={empty} />
  const pages = Math.ceil(sorted.length / PAGE)
  const shown = sorted.slice((page - 1) * PAGE, page * PAGE)
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default text-xs text-foreground-muted">
              {cols.map(c => (
                <th
                  key={c.key}
                  className={`py-2 px-2 font-medium whitespace-nowrap ${c.num ? 'text-right' : 'text-left'} ${c.sort ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                  onClick={() => {
                    if (!c.sort) return
                    if (sortKey === c.key) setDesc(d => !d)
                    else {
                      setSortKey(c.key)
                      setDesc(true)
                    }
                  }}
                >
                  {c.label}
                  {sortKey === c.key ? (desc ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={rowKey(r)} className="border-b border-border-default/60 last:border-0">
                {cols.map(c => (
                  <td key={c.key} className={`py-2 px-2 align-top ${c.num ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 pt-3 text-xs text-foreground-muted">
          <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-border-default rounded disabled:opacity-40">
            Prev
          </button>
          {page} / {pages}
          <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-border-default rounded disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  )
}

/** Standard metric columns for any row carrying Kpis. */
function metricCols<T extends Kpis>(currency: string, opts: { value?: boolean } = {}): Col<T>[] {
  const cols: Col<T>[] = [
    { key: 'cost', label: 'Cost', num: true, render: r => money(r.cost, currency), sort: r => r.cost },
    { key: 'impr', label: 'Impr.', num: true, render: r => count(r.impressions), sort: r => r.impressions },
    { key: 'clicks', label: 'Clicks', num: true, render: r => count(r.clicks), sort: r => r.clicks },
    { key: 'ctr', label: 'CTR', num: true, render: r => pct(r.ctr), sort: r => r.ctr ?? 0 },
    { key: 'cpc', label: 'Avg CPC', num: true, render: r => money(r.avgCpc, currency, 2), sort: r => r.avgCpc ?? 0 },
    { key: 'conv', label: 'Conv.', num: true, render: r => decimal(r.conversions), sort: r => r.conversions },
  ]
  if (opts.value !== false) {
    cols.push(
      { key: 'value', label: 'Conv. value', num: true, render: r => money(r.conversionsValue, currency), sort: r => r.conversionsValue },
      { key: 'roas', label: 'ROAS', num: true, render: r => ratio(r.roas), sort: r => r.roas ?? 0 }
    )
  }
  return cols
}

const SERIES: SeriesDef[] = [
  { key: 'cost', label: 'Cost', color: 'rgb(239 68 68)', kind: 'line', axis: 'money', on: true },
  { key: 'conversionsValue', label: 'Conv. value', color: 'rgb(16 185 129)', kind: 'line', axis: 'money', on: true },
  { key: 'clicks', label: 'Clicks', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'conversions', label: 'Conversions', color: 'rgb(168 85 247)', kind: 'line', axis: 'count', on: false },
  { key: 'impressions', label: 'Impressions', color: 'rgb(234 179 8)', kind: 'line', axis: 'count', on: false },
]

const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']

export function OverviewView({ d, currency }: { d: OverviewData; currency: string }) {
  const k = d.kpis
  const p = d.previousKpis
  const score = d.account?.optimization_score == null ? null : Number(d.account.optimization_score)
  const points = d.trend.map(t => ({
    label: t.label,
    cost: t.cost,
    conversionsValue: t.conversionsValue,
    clicks: t.clicks,
    conversions: t.conversions,
    impressions: t.impressions,
  }))
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Spend" value={money(k.cost, currency)} delta={change(k.cost, p.cost)} invert />
        <Kpi label="Impressions" value={count(k.impressions)} delta={change(k.impressions, p.impressions)} />
        <Kpi label="Clicks" value={count(k.clicks)} delta={change(k.clicks, p.clicks)} />
        <Kpi label="CTR" value={pct(k.ctr)} delta={change(k.ctr, p.ctr)} />
        <Kpi label="Avg CPC" value={money(k.avgCpc, currency, 2)} delta={change(k.avgCpc, p.avgCpc)} invert />
        <Kpi label="Conversions" value={decimal(k.conversions)} delta={change(k.conversions, p.conversions)} />
        <Kpi label="Conv. value" value={money(k.conversionsValue, currency)} delta={change(k.conversionsValue, p.conversionsValue)} />
        <Kpi label="ROAS (Google)" value={ratio(k.roas)} delta={change(k.roas, p.roas)} />
        <Kpi label="Cost / conv." value={money(k.costPerConversion, currency)} delta={change(k.costPerConversion, p.costPerConversion)} invert />
        <Kpi
          label="Optimization score"
          value={score == null ? '-' : `${Math.round(score * 100)}%`}
          sub={d.policyIssues ? `${d.policyIssues} ad(s) with policy issues` : 'No policy issues'}
        />
      </div>

      <Section title="Our orders from Google Ads">
        {!d.orders.available ? (
          <p className="text-sm text-foreground-muted">
            Click tracking on orders is not available on this store yet, so revenue from your own orders cannot be shown.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Kpi label="Orders" value={count(d.orders.orders)} />
              <Kpi label="Net revenue" value={money(d.returns.netRevenue, currency)} sub={d.orders.refunds ? `after ${money(d.orders.refunds, currency)} refunds` : undefined} />
              <Kpi label="True ROAS" value={ratio(d.returns.trueRoas)} highlight sub="net revenue / spend" />
              <Kpi label="Gross profit" value={money(d.returns.grossProfit, currency)} sub="ex tax, less cost price" />
              <Kpi label="POAS" value={ratio(d.returns.poas)} highlight sub="gross profit / spend" />
              <Kpi label="Profit after ads" value={money(d.returns.profitAfterAds, currency)} />
            </div>
            <p className="text-xs text-foreground-muted">
              Paid, non-cancelled orders placed in this range that carried a Google click id (gclid, gbraid or wbraid), less
              completed return refunds. Google&apos;s own conversion value above may count differently (attribution window,
              view-throughs).
            </p>
          </div>
        )}
      </Section>

      <Section title="Trend">
        <TrendChart points={points} series={SERIES} ariaLabel="Ad spend, value and clicks over time" />
      </Section>

      <div className="grid gap-5 md:grid-cols-3">
        <Section title="By network">
          <DonutSplit
            segments={d.byNetwork.map((r, i) => ({ label: humanize(r.network), value: Math.round(r.cost), color: PALETTE[i % PALETTE.length] }))}
            centerLabel="Spend"
            centerValue={money(k.cost, currency)}
          />
        </Section>
        <Section title="By device">
          <DonutSplit
            segments={d.byDevice.map((r, i) => ({ label: humanize(r.device), value: Math.round(r.cost), color: PALETTE[i % PALETTE.length] }))}
            centerLabel="Spend"
            centerValue={money(k.cost, currency)}
          />
        </Section>
        <Section title="Account health">
          <ul className="text-sm space-y-2">
            <li className="flex justify-between">
              <span className="text-foreground-muted">Optimization score</span>
              <span>{score == null ? '-' : `${Math.round(score * 100)}%`}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-foreground-muted">Disapproved ads</span>
              <span className={d.disapproved ? 'text-red-500 font-medium' : ''}>{d.disapproved}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-foreground-muted">Ads with policy issues</span>
              <span>{d.policyIssues}</span>
            </li>
            {d.account?.budget_status && (
              <li className="flex justify-between">
                <span className="text-foreground-muted">Account budget</span>
                <span>
                  {humanize(d.account.budget_status)}
                  {d.account.budget_limit_micros
                    ? ` · ${money(Number(d.account.budget_served_micros ?? 0) / 1e6, currency)} of ${money(Number(d.account.budget_limit_micros) / 1e6, currency)}`
                    : ''}
                </span>
              </li>
            )}
            <li className="flex justify-between">
              <span className="text-foreground-muted">Last sync</span>
              <span>
                {d.lastSync ? `${new Date(d.lastSync.finished_at ?? d.lastSync.started_at).toLocaleString('en-IN')} (${d.lastSync.status})` : 'Never'}
              </span>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  )
}

export function CampaignsView({ rows, currency }: { rows: any[]; currency: string }) {
  return (
    <Section title={`Campaigns (${rows.length})`}>
      <Table
        rows={rows}
        rowKey={r => r.campaignId}
        cols={[
          { key: 'name', label: 'Campaign', render: r => <span className="font-medium">{r.name}</span>, sort: r => r.name },
          { key: 'status', label: 'Status', render: r => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
          { key: 'type', label: 'Type', render: r => humanize(r.channelType) },
          { key: 'budget', label: 'Budget', num: true, render: r => (r.budget == null ? '-' : `${money(r.budget, currency)}/${r.budgetPeriod === 'DAILY' ? 'day' : humanize(r.budgetPeriod)}`), sort: r => r.budget ?? 0 },
          { key: 'bid', label: 'Bid strategy', render: r => humanize(r.biddingStrategy) },
          ...metricCols<any>(currency),
        ]}
      />
    </Section>
  )
}

export function AdGroupsView({ d, currency }: { d: { adGroups: any[]; ads: any[] }; currency: string }) {
  const disapproved = d.ads.filter(a => a.approvalStatus === 'DISAPPROVED')
  return (
    <div className="space-y-5">
      {disapproved.length > 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          {disapproved.length} ad(s) are disapproved and not running. They are listed first below.
        </div>
      )}
      <Section title={`Ad groups (${d.adGroups.length})`}>
        <Table
          rows={d.adGroups}
          rowKey={r => r.adGroupId}
          cols={[
            { key: 'name', label: 'Ad group', render: r => <span className="font-medium">{r.name}</span>, sort: r => r.name },
            { key: 'campaign', label: 'Campaign', render: r => r.campaignName || '-' },
            { key: 'status', label: 'Status', render: r => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
            { key: 'bid', label: 'Max CPC', num: true, render: r => money(r.cpcBid, currency, 2) },
            ...metricCols<any>(currency),
          ]}
        />
      </Section>
      <Section title={`Ads (${d.ads.length})`}>
        <Table
          rows={d.ads}
          rowKey={r => `${r.adId}`}
          cols={[
            {
              key: 'ad',
              label: 'Ad',
              render: r => (
                <div className="max-w-xs">
                  <p className="font-medium truncate">{r.name || humanize(r.type)}</p>
                  <p className="text-xs text-foreground-muted truncate">{r.adGroupName} · {r.campaignName}</p>
                </div>
              ),
            },
            { key: 'status', label: 'Status', render: r => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
            {
              key: 'policy',
              label: 'Policy',
              render: r => (
                <div className="space-y-1">
                  <Badge tone={statusTone(r.approvalStatus)}>{humanize(r.approvalStatus)}</Badge>
                  {r.policyTopics?.length > 0 && (
                    <p className="text-xs text-foreground-muted">{r.policyTopics.map((t: any) => humanize(t.topic)).join(', ')}</p>
                  )}
                </div>
              ),
            },
            ...metricCols<any>(currency, { value: false }),
          ]}
        />
        <p className="text-xs text-foreground-muted mt-2">Ad metrics cover the last 30 days as of the last full sync.</p>
      </Section>
    </div>
  )
}

export function KeywordsView({ d, currency }: { d: { keywords: any[]; searchTerms: any[] }; currency: string }) {
  const [onlyMissing, setOnlyMissing] = useState(false)
  const terms = onlyMissing ? d.searchTerms.filter(t => !t.inCatalogue) : d.searchTerms
  const missingSpend = d.searchTerms.filter(t => !t.inCatalogue).reduce((s, t) => s + t.cost, 0)
  return (
    <div className="space-y-5">
      <Section
        title={`Search terms (${d.searchTerms.length})`}
        action={
          <label className="text-xs flex items-center gap-2 text-foreground-muted">
            <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} />
            Only terms we don&apos;t sell ({money(missingSpend, currency)})
          </label>
        }
      >
        <Table
          rows={terms}
          rowKey={r => r.term}
          cols={[
            {
              key: 'term',
              label: 'Search term',
              render: r => (
                <div>
                  <span className="font-medium">{r.term}</span>{' '}
                  {!r.inCatalogue && <Badge tone="amber">Not in catalogue</Badge>}
                </div>
              ),
              sort: r => r.term,
            },
            { key: 'kw', label: 'Matched keyword', render: r => r.keyword || '-' },
            ...metricCols<any>(currency),
          ]}
        />
        <p className="text-xs text-foreground-muted mt-2">
          &quot;Not in catalogue&quot; means no product or category name matches the term and shoppers searching it on the store
          found nothing. Candidates for negative keywords.
        </p>
      </Section>
      <Section title={`Keywords (${d.keywords.length})`}>
        <Table
          rows={d.keywords}
          rowKey={r => r.criterionId + r.adGroupName}
          cols={[
            { key: 'text', label: 'Keyword', render: r => <span className="font-medium">{r.negative ? `-${r.text}` : r.text}</span>, sort: r => r.text },
            { key: 'match', label: 'Match', render: r => humanize(r.matchType) },
            { key: 'group', label: 'Ad group', render: r => r.adGroupName || '-' },
            { key: 'qs', label: 'QS', num: true, render: r => r.qualityScore ?? '-', sort: r => r.qualityScore ?? 0 },
            ...metricCols<any>(currency),
          ]}
        />
        <p className="text-xs text-foreground-muted mt-2">Keyword metrics cover the last 30 days as of the last full sync.</p>
      </Section>
    </div>
  )
}

const FLAG_LABEL: Record<ProductRow['flags'][number], [string, 'red' | 'amber' | 'muted']> = {
  out_of_stock: ['Out of stock', 'red'],
  negative_margin: ['Sells at a loss', 'red'],
  unprofitable: ['Ad cost > margin', 'amber'],
  unmatched: ['No SKU match', 'muted'],
}

export function ProductsView({ d, currency }: { d: { items: ProductRow[]; bestsellersWithoutImpressions: any[] }; currency: string }) {
  const flagged = d.items.filter(i => i.flags.some(f => f !== 'unmatched'))
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Spend on out-of-stock items" value={money(d.items.filter(i => i.flags.includes('out_of_stock')).reduce((s, i) => s + i.cost, 0), currency)} />
        <Kpi label="Spend on loss-making items" value={money(d.items.filter(i => i.flags.includes('negative_margin') || i.flags.includes('unprofitable')).reduce((s, i) => s + i.cost, 0), currency)} />
        <Kpi label="Flagged items" value={count(flagged.length)} />
      </div>
      <Section title={`Shopping items (${d.items.length})`}>
        <Table
          rows={d.items}
          rowKey={r => r.itemId}
          cols={[
            {
              key: 'item',
              label: 'Item',
              render: r => (
                <div className="max-w-xs">
                  <p className="font-medium truncate">{r.productName || r.title || r.itemId}</p>
                  <p className="text-xs text-foreground-muted">{r.sku || r.itemId}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.flags.map(f => (
                      <Badge key={f} tone={FLAG_LABEL[f][1]}>
                        {FLAG_LABEL[f][0]}
                      </Badge>
                    ))}
                  </div>
                </div>
              ),
              sort: r => r.productName || r.title || '',
            },
            { key: 'stock', label: 'Stock', num: true, render: r => (r.stock == null ? '-' : decimal(r.stock, 0)), sort: r => r.stock ?? 0 },
            { key: 'price', label: 'Price', num: true, render: r => money(r.price, currency) },
            { key: 'margin', label: 'Unit margin', num: true, render: r => money(r.unitMargin, currency), sort: r => r.unitMargin ?? 0 },
            ...metricCols<ProductRow>(currency),
          ]}
        />
        <p className="text-xs text-foreground-muted mt-2">Price and margin are ex-GST (selling price less cost price).</p>
      </Section>
      <Section title="Best sellers Google isn't showing">
        {d.bestsellersWithoutImpressions.length === 0 ? (
          <Empty msg="Every best seller in this range got impressions." />
        ) : (
          <RankedBars
            items={d.bestsellersWithoutImpressions.map(b => ({ name: `${b.name} (${b.sku})`, value: b.units, sub: money(b.revenue, currency) }))}
            unit="sold"
          />
        )}
      </Section>
    </div>
  )
}

export function LocationsView({ rows, currency }: { rows: any[]; currency: string }) {
  return (
    <Section title={`Locations (${rows.length})`}>
      <Table rows={rows} rowKey={r => r.location} cols={[{ key: 'loc', label: 'Location', render: r => r.location, sort: r => r.location }, ...metricCols<any>(currency)]} />
      <p className="text-xs text-foreground-muted mt-2">Where people were physically located when they saw or clicked an ad.</p>
    </Section>
  )
}

export function RecommendationsView({ rows, currency }: { rows: any[]; currency: string }) {
  return (
    <Section title={`Recommendations (${rows.length})`}>
      <Table
        rows={rows}
        rowKey={r => r.id}
        empty="No open recommendations."
        cols={[
          { key: 'type', label: 'Recommendation', render: r => <span className="font-medium">{humanize(r.type)}</span>, sort: r => r.type },
          { key: 'campaign', label: 'Campaign', render: r => r.campaignName || 'Account' },
          { key: 'clicks', label: 'Extra clicks', num: true, render: r => (r.extraClicks == null ? '-' : count(r.extraClicks)) },
          { key: 'conv', label: 'Extra conv.', num: true, render: r => (r.extraConversions == null ? '-' : decimal(r.extraConversions)) },
          { key: 'cost', label: 'Extra cost', num: true, render: r => (r.extraCost == null ? '-' : money(r.extraCost, currency)) },
        ]}
      />
      <p className="text-xs text-foreground-muted mt-2">Read-only. Apply or dismiss them in Google Ads.</p>
    </Section>
  )
}

export function ChangesView({ rows }: { rows: any[] }) {
  return (
    <Section title="Change history (last 14 days)">
      <Table
        rows={rows}
        rowKey={r => `${r.change_date_time}${r.resource_type}${r.changed_fields}`}
        empty="No changes recorded."
        cols={[
          { key: 'when', label: 'When', render: r => r.change_date_time || '-' },
          { key: 'what', label: 'What', render: r => `${humanize(r.operation)} ${humanize(r.resource_type).toLowerCase()}` },
          { key: 'campaign', label: 'Campaign', render: r => r.campaign_name || '-' },
          { key: 'fields', label: 'Fields', render: r => <span className="text-xs text-foreground-muted break-all">{r.changed_fields || '-'}</span> },
          { key: 'who', label: 'By', render: r => r.user_email || humanize(r.client_type) },
        ]}
      />
    </Section>
  )
}

export function SyncView({ rows }: { rows: any[] }) {
  return (
    <Section title="Sync history">
      <Table
        rows={rows}
        rowKey={r => String(r.id)}
        empty="No syncs yet."
        cols={[
          { key: 'started', label: 'Started', render: r => new Date(r.started_at).toLocaleString('en-IN') },
          { key: 'mode', label: 'Mode', render: r => (r.mode === 'today' ? 'Today' : 'Full (30 days)') },
          { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'success' ? 'green' : r.status === 'partial' ? 'amber' : 'red'}>{humanize(r.status)}</Badge> },
          { key: 'range', label: 'Dates', render: r => (r.date_from ? `${r.date_from} to ${r.date_to}` : '-') },
          {
            key: 'rows',
            label: 'Rows',
            render: r => (
              <span className="text-xs text-foreground-muted">
                {Object.entries(r.rows ?? {})
                  .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
                  .join(' · ') || '-'}
              </span>
            ),
          },
          {
            key: 'errors',
            label: 'Errors',
            render: r =>
              (r.errors ?? []).length ? (
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 max-w-md">
                  {(r.errors as any[]).map((e, i) => (
                    <li key={i}>
                      <b>{e.step}</b>: {e.message}
                    </li>
                  ))}
                </ul>
              ) : (
                '-'
              ),
          },
        ]}
      />
    </Section>
  )
}
