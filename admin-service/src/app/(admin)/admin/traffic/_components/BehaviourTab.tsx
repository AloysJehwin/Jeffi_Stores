'use client'

import { Empty, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import type { BehaviourData, PageRow } from '@/lib/traffic/types'
import { Donut, HBars, Heatmap, PALETTE } from './charts'
import { Note, rateText, ratio } from './shared'

const PAGE_LABELS: Record<string, string> = {
  home: 'Home',
  categories: 'All categories',
  category: 'Category',
  product: 'Product',
  cart: 'Cart',
  checkout: 'Checkout',
  order_placed: 'Order page',
  search: 'Search',
}

type Landing = BehaviourData['landing'][number]

export default function BehaviourTab({ data }: { data: BehaviourData }) {
  if (!data.pages.length) return <Empty msg="No tracked page views in this period yet." />

  const pageCols: Col<PageRow>[] = [
    { key: 'path', label: 'Page', render: r => <span className="break-all">{r.path}</span>, sort: r => r.path },
    { key: 'views', label: 'Views', num: true, sort: r => r.views, render: r => count(r.views) },
    { key: 'sessions', label: 'Sessions', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'entries', label: 'Entries', num: true, sort: r => r.entries, render: r => count(r.entries) },
    { key: 'exits', label: 'Exits', num: true, sort: r => r.exits, render: r => count(r.exits) },
    { key: 'exitRate', label: 'Exit rate', num: true, sort: r => ratio(r.exits, r.views) ?? -1, render: r => rateText(r.exits, r.views) },
  ]
  const landingCols: Col<Landing>[] = [
    { key: 'path', label: 'Landing page', render: r => <span className="break-all">{r.path}</span>, sort: r => r.path },
    { key: 'sessions', label: 'Sessions', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'bounce', label: 'Bounce', num: true, sort: r => ratio(r.bounces, r.sessions) ?? -1, render: r => rateText(r.bounces, r.sessions) },
    { key: 'conv', label: 'Conversion', num: true, sort: r => ratio(r.convertedSessions, r.sessions) ?? -1, render: r => rateText(r.convertedSessions, r.sessions, 2) },
    { key: 'revenue', label: 'Revenue (tracked)', num: true, sort: r => r.revenue, render: r => money(r.revenue) },
  ]
  const totalViews = data.pageTypes.reduce((s, r) => s + r.views, 0)

  return (
    <div className="space-y-5">
      <Section title="Top pages">
        <Table rows={data.pages} cols={pageCols} rowKey={r => r.path} />
      </Section>

      <Section title="Landing pages">
        <Table rows={data.landing} cols={landingCols} rowKey={r => r.path} empty="No sessions yet" />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Views by page type">
          <Donut
            segments={data.pageTypes.map((t, i) => ({
              label: PAGE_LABELS[t.page] ?? t.page,
              value: t.views,
              color: PALETTE[i % PALETTE.length],
            }))}
          />
          {totalViews > 0 && <Note>Account pages other than an order are not tracked.</Note>}
        </Section>
        <Section title="Session depth (pages per session)">
          <HBars
            empty="No sessions yet"
            rows={data.depth.map(d => ({ key: d.bucket, label: `${d.bucket} page${d.bucket === '1' ? '' : 's'}`, value: d.sessions }))}
          />
        </Section>
      </div>

      <Section title="Page views by weekday and hour (IST)">
        <Heatmap cells={data.heatmap} />
      </Section>

      <Note>
        Not-found (404) pages are not tracked: the storefront tracker only records known page types, so there is no 404
        report yet.
      </Note>
    </div>
  )
}
