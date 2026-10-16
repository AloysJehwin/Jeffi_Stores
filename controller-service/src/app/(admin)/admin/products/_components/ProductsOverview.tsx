'use client'

import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { AttentionList } from '@/components/admin/overview/kit'
import { Badge, Empty, Kpi, KpiGrid, Section, Table, count, money, pct, when } from '@/components/admin/channels/ui'
import { delta, ratio } from '@/lib/overview/period'
import { Bars, OverviewFrame, withAp } from './catalog-overview'
import type { AttentionItem } from '@/components/admin/overview/kit'

type Issue = 'no_price' | 'no_image' | 'no_hsn' | 'no_gst' | 'no_cost' | 'no_description' | 'out_of_stock'

const ISSUES: { id: Issue; label: string }[] = [
  { id: 'no_price', label: 'No price' },
  { id: 'no_image', label: 'No image' },
  { id: 'no_hsn', label: 'No HSN code' },
  { id: 'no_gst', label: 'No GST rate' },
  { id: 'no_cost', label: 'No cost price' },
  { id: 'no_description', label: 'No description' },
  { id: 'out_of_stock', label: 'Out of stock' },
]

interface Stats {
  sales: number
  units: number
  orders: number
  productsSold: number
  views: number
  added: number
  priceChanges: number
  productsRepriced: number
  margin: number | null
}

interface ProductsOverviewData {
  bucket: 'day' | 'week' | 'month'
  health: Record<'total' | 'active' | 'inactive' | 'drafts' | 'complete' | Issue, number> & {
    samples: Record<Issue, { id: string; name: string; sales: number; views: number }[]>
  }
  current: Stats
  previousStats: Stats
  series: { bucket: string; sales: number; units: number; views: number }[]
  topSellers: {
    id: string
    name: string
    units: number
    sales: number
    prevSales: number
    views: number
    margin: number | null
  }[]
  mostViewed: { id: string; name: string; views: number; sessions: number; orders: number; units: number }[]
  neverSold: { total: number; items: { id: string; name: string; createdAt: string; views: number }[] }
  recentlyAdded: { id: string; name: string; isActive: boolean; createdAt: string; issues: Issue[] }[]
  priceChanges: {
    bulk: number
    manual: number
    increases: number
    decreases: number
    cleared: number
    avgChange: number | null
    recent: {
      id: string
      at: string
      productId: string | null
      name: string | null
      variant: string | null
      from: number | null
      to: number | null
      change: number | null
      bulk: boolean
    }[]
  }
  attention: AttentionItem[]
}

const productHref = (id: string) => ap(`/admin/products/${id}`)
const ProductLink = ({ id, name }: { id: string | null; name: string | null }) =>
  id ? (
    <Link href={productHref(id)} className="text-foreground hover:text-accent-500 break-words">
      {name || 'Unnamed product'}
    </Link>
  ) : (
    <span className="text-foreground-muted">{name || 'Deleted product'}</span>
  )

const bucketLabel = (b: string, bucket: ProductsOverviewData['bucket']) =>
  bucket === 'month'
    ? new Date(b).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    : new Date(b).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export default function ProductsOverview() {
  return (
    <OverviewFrame<ProductsOverviewData> endpoint="/api/admin/products/overview">{d => <Body d={d} />}</OverviewFrame>
  )
}

function Body({ d }: { d: ProductsOverviewData }) {
  const c = d.current
  const p = d.previousStats
  const h = d.health
  const complete = ratio(h.complete, h.active)
  return (
    <div className="space-y-4">
      <KpiGrid>
        <Kpi
          label="Product sales"
          value={money(c.sales)}
          delta={delta(c.sales, p.sales)}
          sub={`${count(c.orders)} paid orders`}
          highlight
        />
        <Kpi
          label="Units sold"
          value={count(c.units)}
          delta={delta(c.units, p.units)}
          sub={`${count(c.productsSold)} products sold`}
        />
        <Kpi
          label="Product views"
          value={count(c.views)}
          delta={delta(c.views, p.views)}
          sub={`${pct(ratio(c.orders, c.views))} views to orders`}
        />
        <Kpi
          label="Gross margin"
          value={pct(c.margin)}
          sub={c.margin == null ? 'Add cost prices to measure' : 'ex-GST, costed lines'}
        />
        <Kpi
          label="Catalogue complete"
          value={pct(complete, 0)}
          sub={`${count(h.complete)} of ${count(h.active)} active`}
        />
        <Kpi
          label="Repriced"
          value={count(c.productsRepriced)}
          delta={delta(c.productsRepriced, p.productsRepriced)}
          sub={`${count(c.added)} added`}
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionList items={withAp(d.attention)} />
        <Section title="Product sales">
          {d.series.some(s => s.sales > 0) ? (
            <Bars
              rows={d.series}
              value={s => s.sales}
              label={s => bucketLabel(s.bucket, d.bucket)}
              format={v => money(v)}
            />
          ) : (
            <Empty msg="No product sales in this period" />
          )}
        </Section>
      </div>

      <div id="health">
        <Section title="Catalogue health">
          <div className="flex flex-wrap gap-2 mb-4 text-xs text-foreground-muted">
            <Badge tone="green">{count(h.active)} active</Badge>
            <Badge>{count(h.inactive)} inactive</Badge>
            {h.drafts > 0 && <Badge tone="blue">{count(h.drafts)} drafts</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ISSUES.map(i => (
              <div key={i.id} className="rounded-lg border border-border-default bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs text-foreground-muted">{i.label}</p>
                  <p
                    className={`text-lg font-bold tabular-nums ${h[i.id] ? 'text-foreground' : 'text-green-600 dark:text-green-400'}`}
                  >
                    {count(h[i.id])}
                  </p>
                </div>
                <p className="text-[11px] text-foreground-muted">{pct(ratio(h[i.id], h.active))} of active</p>
                {h.samples[i.id]?.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {h.samples[i.id].map(s => (
                      <li key={s.id} className="truncate">
                        <Link
                          href={ap(`/admin/products/${s.id}/edit`)}
                          className="text-foreground-secondary hover:text-accent-500"
                        >
                          {s.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Top sellers">
          <Table
            rows={d.topSellers}
            rowKey={r => r.id}
            empty="No sales in this period"
            cols={[
              { key: 'name', label: 'Product', render: r => <ProductLink id={r.id} name={r.name} /> },
              { key: 'units', label: 'Units', num: true, render: r => count(r.units), sort: r => r.units },
              { key: 'sales', label: 'Sales', num: true, render: r => money(r.sales), sort: r => r.sales },
              {
                key: 'chg',
                label: 'vs prev',
                num: true,
                render: r => pct(delta(r.sales, r.prevSales), 0),
                sort: r => delta(r.sales, r.prevSales) ?? 0,
              },
              { key: 'margin', label: 'Margin', num: true, render: r => pct(r.margin, 0) },
            ]}
          />
        </Section>
        <Section title="Most viewed">
          <Table
            rows={d.mostViewed}
            rowKey={r => r.id}
            empty="No product views in this period"
            cols={[
              { key: 'name', label: 'Product', render: r => <ProductLink id={r.id} name={r.name} /> },
              { key: 'views', label: 'Views', num: true, render: r => count(r.views), sort: r => r.views },
              { key: 'orders', label: 'Orders', num: true, render: r => count(r.orders), sort: r => r.orders },
              {
                key: 'conv',
                label: 'View to order',
                num: true,
                render: r => pct(ratio(r.orders, r.views)),
                sort: r => ratio(r.orders, r.views) ?? 0,
              },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div id="never-sold">
          <Section title={`Never sold (${count(d.neverSold.total)})`}>
            <p className="text-xs text-foreground-muted mb-2">
              Active, listed over 30 days, never on a paid order. Most viewed first.
            </p>
            <Table
              rows={d.neverSold.items}
              rowKey={r => r.id}
              empty="Every product older than 30 days has sold"
              cols={[
                { key: 'name', label: 'Product', render: r => <ProductLink id={r.id} name={r.name} /> },
                { key: 'views', label: 'Views', num: true, render: r => count(r.views) },
                { key: 'added', label: 'Listed', render: r => when(r.createdAt) },
              ]}
            />
          </Section>
        </div>
        <Section title="Recently added">
          <Table
            rows={d.recentlyAdded}
            rowKey={r => r.id}
            empty="No products added in this period"
            cols={[
              { key: 'name', label: 'Product', render: r => <ProductLink id={r.id} name={r.name} /> },
              {
                key: 'state',
                label: 'Status',
                render: r => (
                  <div className="flex flex-wrap gap-1">
                    {!r.isActive && <Badge>Inactive</Badge>}
                    {r.issues.length === 0 ? (
                      <Badge tone="green">Complete</Badge>
                    ) : (
                      r.issues.map(i => (
                        <Badge key={i} tone="amber">
                          {ISSUES.find(x => x.id === i)?.label}
                        </Badge>
                      ))
                    )}
                  </div>
                ),
              },
              { key: 'added', label: 'Added', render: r => when(r.createdAt) },
            ]}
          />
        </Section>
      </div>

      <Section title="Price changes">
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          <Badge tone="blue">{count(d.priceChanges.manual)} manual</Badge>
          <Badge tone="blue">{count(d.priceChanges.bulk)} bulk</Badge>
          <Badge tone="amber">{count(d.priceChanges.increases)} up</Badge>
          <Badge tone="green">{count(d.priceChanges.decreases)} down</Badge>
          {d.priceChanges.cleared > 0 && <Badge tone="red">{count(d.priceChanges.cleared)} set to zero</Badge>}
          <span className="text-foreground-muted self-center">Average change {pct(d.priceChanges.avgChange)}</span>
        </div>
        <Table
          rows={d.priceChanges.recent}
          rowKey={r => r.id}
          empty="No price changes in this period"
          cols={[
            {
              key: 'name',
              label: 'Product',
              render: r => (
                <span>
                  <ProductLink id={r.productId} name={r.name} />
                  {r.variant && <span className="text-foreground-muted"> / {r.variant}</span>}
                </span>
              ),
            },
            { key: 'from', label: 'From', num: true, render: r => money(r.from, 2) },
            { key: 'to', label: 'To', num: true, render: r => money(r.to, 2) },
            { key: 'chg', label: 'Change', num: true, render: r => pct(r.change) },
            {
              key: 'src',
              label: 'Source',
              render: r => <Badge tone={r.bulk ? 'blue' : 'muted'}>{r.bulk ? 'Bulk' : 'Manual'}</Badge>,
            },
            { key: 'at', label: 'When', render: r => when(r.at) },
          ]}
        />
      </Section>
    </div>
  )
}
