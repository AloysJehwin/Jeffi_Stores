'use client'

import { useMemo, useState } from 'react'
import { ExternalLink, Wrench } from 'lucide-react'
import { TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import PreviewApply from '@/components/admin/channels/PreviewApply'
import { Badge, Empty, Kpi, KpiGrid, Section, Table, api, change, count, money, pct, when } from '@/components/admin/channels/ui'

const SERIES: SeriesDef[] = [
  { key: 'organic', label: 'Free listing clicks', color: 'rgb(16 185 129)', kind: 'bar', axis: 'count', on: true },
  { key: 'ads', label: 'Shopping ad clicks', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'impressions', label: 'Impressions', color: 'rgb(234 179 8)', kind: 'line', axis: 'count', on: false },
]

const ctr = (c: number, i: number) => (i ? c / i : null)

export function OverviewView({ d }: { d: any }) {
  if (!d) return null
  const t = d.totals
  const p = d.previous
  const s = d.summary
  const bs = d.bestsellers ?? {}
  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Clicks" value={count(t.clicks)} delta={change(t.clicks, p.clicks)} />
        <Kpi label="Impressions" value={count(t.impressions)} delta={change(t.impressions, p.impressions)} />
        <Kpi label="CTR" value={pct(ctr(t.clicks, t.impressions), 2)} />
        <Kpi label="Free listing clicks" value={count(d.organic.clicks)} sub={`${count(d.ads.clicks)} from Shopping ads`} highlight />
        <Kpi label="Conversions" value={count(t.conversions)} delta={change(t.conversions, p.conversions)} sub={money(t.value)} />
        <Kpi
          label="Products approved"
          value={s ? `${count(s.approved)} / ${count(s.total)}` : '-'}
          sub={s ? `${count(s.disapproved)} disapproved, ${count(s.pending)} pending` : 'Refresh the status'}
        />
      </KpiGrid>
      <Section title="Clicks by day">
        {d.daily.length ? <TrendChart points={d.daily.map((x: any) => ({ label: x.date, organic: x.organic, ads: x.ads, impressions: x.impressions }))} series={SERIES} ariaLabel="Merchant clicks by day" /> : <Empty msg="No performance data yet. Refresh reports (top right)." />}
      </Section>
      <div className="grid gap-5 md:grid-cols-3">
        <Section title="Account">
          <p className="text-sm">
            {d.accountIssues ? <Badge tone="red">{d.accountIssues} account issue(s)</Badge> : <Badge tone="green">No account issues</Badge>}
          </p>
          <p className="text-xs text-foreground-muted mt-2">Status refreshed {when(s?.last_refreshed_at)}</p>
        </Section>
        <Section title="Last product push">
          {d.lastPush ? (
            <>
              <Badge tone={d.lastPush.status === 'success' ? 'green' : d.lastPush.status === 'running' ? 'amber' : 'red'}>{d.lastPush.status}</Badge>
              <p className="text-xs text-foreground-muted mt-2">
                {count(d.lastPush.synced)} pushed, {when(d.lastPush.finished_at ?? d.lastPush.started_at)}
              </p>
            </>
          ) : (
            <Empty msg="No push yet" />
          )}
        </Section>
        <Section title="Best sellers in India">
          <ul className="text-sm space-y-1">
            <li>{count(bs.in_stock ?? 0)} you sell and have in stock</li>
            <li className={bs.not_listed ? 'text-amber-600' : ''}>{count(bs.not_listed ?? 0)} you carry but Google does not show</li>
            <li>{count(bs.out_of_stock ?? 0)} you list but are out of stock</li>
            <li className="text-foreground-muted">{count(bs.not_carried ?? 0)} you do not carry</li>
          </ul>
        </Section>
      </div>
    </div>
  )
}

export function PerformanceView({ d }: { d: any }) {
  return (
    <Section title="Products on Google">
      <Table
        rows={d?.rows ?? []}
        rowKey={(r: any) => r.offerId}
        empty="No clicks or impressions in this range."
        cols={[
          { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.offerId },
          { key: 'organic', label: 'Free clicks', num: true, render: (r: any) => count(r.organicClicks), sort: (r: any) => r.organicClicks },
          { key: 'ads', label: 'Ad clicks', num: true, render: (r: any) => count(r.adsClicks), sort: (r: any) => r.adsClicks },
          { key: 'impr', label: 'Impr.', num: true, render: (r: any) => count(r.impressions), sort: (r: any) => r.impressions },
          { key: 'ctr', label: 'CTR', num: true, render: (r: any) => pct(ctr(r.clicks, r.impressions), 2), sort: (r: any) => ctr(r.clicks, r.impressions) ?? 0 },
          { key: 'conv', label: 'Conv.', num: true, render: (r: any) => count(r.conversions), sort: (r: any) => r.conversions },
          { key: 'value', label: 'Value', num: true, render: (r: any) => money(r.value), sort: (r: any) => r.value },
        ]}
      />
    </Section>
  )
}

function IssueDetail({ offerId }: { offerId: string }) {
  const [state, setState] = useState<{ issues?: any[]; error?: string } | null>(null)
  if (!state)
    return (
      <button
        type="button"
        className="text-xs text-accent-500 underline"
        onClick={async () => {
          setState({})
          const r = await api(`/api/admin/merchant/console/issues/${encodeURIComponent(offerId)}`)
          setState(r.ok ? { issues: r.data.issues } : { error: r.data.error || 'Could not load' })
        }}
      >
        {offerId}
      </button>
    )
  if (state.error) return <span className="text-xs text-red-500">{state.error}</span>
  if (!state.issues) return <span className="text-xs text-foreground-muted">Loading...</span>
  if (!state.issues.length) return <span className="text-xs text-foreground-muted">{offerId}: no issues now</span>
  return (
    <div className="rounded border border-border-default p-2 space-y-2 text-xs">
      <p className="font-medium">{offerId}</p>
      {state.issues.map((i, n) => (
        <div key={n}>
          <p className="font-medium">{i.title}</p>
          {i.impact && <p className="text-foreground-muted">{i.impact}</p>}
          <div className="flex flex-wrap gap-2 mt-1">
            {i.actions
              .filter((a: any) => a.uri)
              .map((a: any) => (
                <a key={a.label} href={a.uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-500 underline">
                  {a.label} <ExternalLink className="w-3 h-3" />
                </a>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function IssuesView({ d }: { d: any }) {
  const groups = d?.groups ?? []
  return (
    <Section title="Product issues by type">
      {!groups.length ? (
        <Empty msg="No product issues in the last status refresh." />
      ) : (
        <div className="space-y-3">
          {groups.map((g: any) => (
            <details key={g.code} className="rounded-lg border border-border-default p-3">
              <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
                <Badge tone={g.servability === 'disapproved' ? 'red' : 'amber'}>{g.servability || 'issue'}</Badge>
                <span className="font-medium text-sm">{g.description || g.code}</span>
                <span className="text-xs text-foreground-muted">{count(g.products)} product(s)</span>
              </summary>
              {g.detail && <p className="text-xs text-foreground-muted mt-2">{g.detail}</p>}
              {g.documentation && (
                <a href={g.documentation} target="_blank" rel="noreferrer" className="text-xs text-accent-500 underline inline-flex items-center gap-1 mt-1">
                  Google help <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <p className="text-xs text-foreground-muted mt-2">Click a product for Google&apos;s explanation and fix links:</p>
              <div className="flex flex-col gap-1 mt-1">
                {g.offers.map((o: string) => (
                  <IssueDetail key={o} offerId={o} />
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </Section>
  )
}

export function CompetitivenessView({ d }: { d: any }) {
  const rows = d?.rows ?? []
  return (
    <Section title="Your price vs the market (benchmark)">
      {!rows.length ? (
        <Empty msg="Google has no price benchmarks for your products yet (it needs other sellers of the same product). Refresh reports to check again." />
      ) : (
        <Table
          rows={rows}
          rowKey={(r: any) => r.offerId}
          cols={[
            { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.offerId },
            { key: 'price', label: 'Your price', num: true, render: (r: any) => money(r.price), sort: (r: any) => r.price ?? 0 },
            { key: 'bench', label: 'Benchmark', num: true, render: (r: any) => money(r.benchmark), sort: (r: any) => r.benchmark ?? 0 },
            {
              key: 'gap',
              label: 'Gap',
              num: true,
              render: (r: any) => (r.gap == null ? '-' : <Badge tone={r.gap > 0.05 ? 'red' : r.gap < -0.05 ? 'green' : 'muted'}>{pct(r.gap)}</Badge>),
              sort: (r: any) => r.gap ?? 0,
            },
            { key: 'clicks', label: 'Clicks 30d', num: true, render: (r: any) => count(r.clicks), sort: (r: any) => r.clicks },
          ]}
        />
      )}
    </Section>
  )
}

export function InsightsView({ d, onChanged }: { d: any; onChanged: () => void }) {
  const canWrite = useCanWrite('merchant_sync')
  const [pending, setPending] = useState<Record<string, unknown> | null>(null)
  const rows = d?.rows ?? []
  const cols = useMemo(
    () => [
      { key: 'title', label: 'Product', render: (r: any) => r.title ?? r.offerId },
      { key: 'price', label: 'Price', num: true, render: (r: any) => money(r.price), sort: (r: any) => r.price ?? 0 },
      { key: 'sug', label: 'Suggested', num: true, render: (r: any) => money(r.suggested), sort: (r: any) => r.suggested ?? 0 },
      { key: 'clk', label: 'Clicks', num: true, render: (r: any) => pct(r.clicksChange), sort: (r: any) => r.clicksChange ?? 0 },
      { key: 'conv', label: 'Conversions', num: true, render: (r: any) => pct(r.conversionsChange), sort: (r: any) => r.conversionsChange ?? 0 },
      {
        key: 'margin',
        label: 'Margin / unit',
        num: true,
        render: (r: any) =>
          r.marginSuggested == null ? '-' : (
            <span className={r.marginSuggested < 0 ? 'text-red-500' : ''}>
              {money(r.marginNow)} → {money(r.marginSuggested)}
            </span>
          ),
        sort: (r: any) => r.marginSuggested ?? 0,
      },
      { key: 'eff', label: 'Confidence', render: (r: any) => <Badge tone={r.effectiveness === 'HIGH' ? 'green' : r.effectiveness === 'MEDIUM' ? 'amber' : 'muted'}>{r.effectiveness ?? '-'}</Badge> },
      ...(canWrite
        ? [
            {
              key: 'act',
              label: '',
              render: (r: any) =>
                r.suggested && r.productId ? (
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-accent-500 underline" onClick={() => setPending({ action: 'product.price', offerId: r.offerId, price: r.suggested })}>
                    <Wrench className="w-3 h-3" /> Use suggested
                  </button>
                ) : null,
            },
          ]
        : []),
    ],
    [canWrite]
  )
  return (
    <Section title="Price insights">
      <p className="text-xs text-foreground-muted mb-3">
        Google&apos;s suggested price and the change it predicts if you used it. Margin uses your cost price and the product&apos;s GST; applying a price changes it on your store and re-sends the product.
      </p>
      {!rows.length ? <Empty msg="No price insights yet. Google shows them once your products have enough traffic." /> : <Table rows={rows} rowKey={(r: any) => r.offerId} cols={cols} />}
      {pending && (
        <PreviewApply
          writeScope="merchant_sync:write"
          endpoint="/api/admin/merchant/console/actions"
          payload={pending}
          applyLabel="Change price"
          onClose={() => setPending(null)}
          onDone={onChanged}
        />
      )}
    </Section>
  )
}

const BS_TONE: Record<string, 'green' | 'amber' | 'red' | 'muted'> = { in_stock: 'green', out_of_stock: 'red', not_listed: 'amber', not_carried: 'muted' }
const BS_LABEL: Record<string, string> = { in_stock: 'Selling', out_of_stock: 'Out of stock', not_listed: 'Carried, not showing', not_carried: 'Not carried' }

export function BestSellersView({ d }: { d: any }) {
  const [filter, setFilter] = useState<string>('all')
  const rows = (d?.rows ?? []).filter((r: any) => filter === 'all' || r.status === filter)
  return (
    <Section
      title={`Best sellers in India${d?.reportDate ? ` (week of ${String(d.reportDate).slice(0, 10)})` : ''}`}
      action={
        <select className="text-xs border border-border-default rounded px-2 py-1 bg-surface" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter best sellers">
          <option value="all">All</option>
          {Object.entries(BS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      }
    >
      {!d?.rows?.length ? (
        <Empty msg="No best-seller data. Google shares it with accounts enrolled in Market insights; refresh reports to check again." />
      ) : (
        <Table
          rows={rows}
          rowKey={(r: any) => r.key}
          cols={[
            { key: 'rank', label: '#', num: true, render: (r: any) => r.rank, sort: (r: any) => r.rank },
            { key: 'move', label: 'Prev', num: true, render: (r: any) => r.previousRank ?? 'new' },
            { key: 'title', label: 'Product', render: (r: any) => r.title },
            { key: 'brand', label: 'Brand', render: (r: any) => r.brand ?? '-' },
            { key: 'cat', label: 'Category', render: (r: any) => <span className="text-xs">{r.category}</span> },
            { key: 'demand', label: 'Demand', render: (r: any) => r.demand ?? '-' },
            { key: 'status', label: 'You', render: (r: any) => <Badge tone={BS_TONE[r.status]}>{BS_LABEL[r.status]}</Badge> },
          ]}
        />
      )}
    </Section>
  )
}
