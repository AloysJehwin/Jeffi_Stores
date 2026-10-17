'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { TrendChart, DonutSplit, RankedBars, type SeriesDef } from '@/components/admin/kit/charts'
import { Section, Table, Kpi, Badge, Empty as KitEmpty, type Col } from '@/components/admin/kit/core'
import { money, count, decimal, pct, ratio, change, humanize } from '@/lib/google-ads/format'
import type { OverviewData, Kpis, ProductRow } from '@/lib/google-ads/report'
import { useAdsManage } from './ManageContext'
import AlertsPanel from './AlertsPanel'
import { MarginBasis, MarginCell, StockBadge } from './RecommendationImpact'
import {
  actionsCol,
  AdGroupRowActions,
  AdRowActions,
  CampaignRowActions,
  ChangeLogPanel,
  KeywordRowActions,
  RecommendationRowActions,
  SearchTermRowActions,
} from './ManageActions'

// One component per console tab. Data shapes come from lib/google-ads/report.ts loaders.

export { Section, Table }

export function Empty({ msg = 'No data in this range' }: { msg?: string }) {
  return <KitEmpty msg={msg} />
}

const statusTone = (s: string | null | undefined): 'green' | 'amber' | 'red' | 'muted' =>
  s === 'ENABLED' || s === 'APPROVED' ? 'green' : s === 'PAUSED' || s === 'APPROVED_LIMITED' ? 'amber' : s === 'DISAPPROVED' ? 'red' : 'muted'


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

      <AlertsPanel />

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
            {d.account?.billing_status && (
              <li className="flex justify-between gap-2">
                <span className="text-foreground-muted">Billing</span>
                <span className="text-right">
                  {d.account.billing_status === 'NONE' ? (
                    <a href="https://ads.google.com/aw/billing/summary" target="_blank" rel="noreferrer" className="text-accent-600 hover:underline">
                      Check in Google Ads
                    </a>
                  ) : (
                    <span className={d.account.billing_status === 'APPROVED' ? '' : 'text-amber-600'}>
                      {humanize(d.account.billing_status)}
                      {d.account.billing_account_name ? ` · ${d.account.billing_account_name}` : ''}
                    </span>
                  )}
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
  const manage = !!useAdsManage()
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
          ...actionsCol<any>(manage, r => <CampaignRowActions row={r} />),
        ]}
      />
    </Section>
  )
}

export function AdGroupsView({ d, currency }: { d: { adGroups: any[]; ads: any[] }; currency: string }) {
  const disapproved = d.ads.filter(a => a.approvalStatus === 'DISAPPROVED')
  const manage = !!useAdsManage()
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
            ...actionsCol<any>(manage, r => <AdGroupRowActions row={r} />),
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
            ...actionsCol<any>(manage, r => <AdRowActions row={r} />),
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
  const manage = !!useAdsManage()
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
            ...actionsCol<any>(manage, r => <SearchTermRowActions row={r} />),
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
            ...actionsCol<any>(manage, r => <KeywordRowActions row={r} />),
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
  const manage = !!useAdsManage()
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
          { key: 'profit', label: 'Profit effect (ours)', num: true, render: r => <MarginCell m={r.margin} currency={currency} />, sort: r => r.margin?.profitImpact ?? 0 },
          { key: 'stock', label: 'Stock', render: r => <StockBadge m={r.margin} /> },
          ...actionsCol<any>(manage, r => <RecommendationRowActions row={r} />),
        ]}
      />
      <p className="text-xs text-foreground-muted mt-2">
        {manage ? 'Apply or dismiss with the buttons on each row.' : 'Read-only. Apply or dismiss them in Google Ads.'}
      </p>
      <MarginBasis rows={rows} />
    </Section>
  )
}

export function ChangesView({ rows }: { rows: any[] }) {
  return (
    <div className="space-y-5">
      <ChangeLogPanel />
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
    </div>
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
