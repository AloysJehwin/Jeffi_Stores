'use client'

import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { Badge, Kpi, Section, Table, count, money, pct, type Tone } from '@/components/admin/channels/ui'
import { delta, ratio } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { OverviewTab } from '../products/_components/catalog-overview'

type Status = 'live' | 'scheduled' | 'ended' | 'hidden'

interface OffersOverviewData {
  counts: { live: number; scheduled: number; ended: number; hidden: number; expiring: number; productsOnOffer: number }
  current: { sales: number; offerSales: number; offerOrders: number }
  previousStats: { sales: number; offerSales: number; offerOrders: number }
  offers: {
    id: string
    title: string
    status: Status
    endsAt: string | null
    products: number
    sales: number
    prevSales: number
    orders: number
  }[]
  attention: AttentionItem[]
}

const TONE: Record<Status, Tone> = { live: 'green', scheduled: 'blue', ended: 'muted', hidden: 'muted' }
const LABEL: Record<Status, string> = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', hidden: 'Hidden' }
const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : 'No end'

export default function OffersOverview() {
  return (
    <OverviewTab<OffersOverviewData>
      endpoint="/api/admin/offers/overview"
      kpis={d => (
        <>
          <Kpi label="Live offers" value={count(d.counts.live)} sub={`${count(d.counts.scheduled)} scheduled`} />
          <Kpi label="Ending in 7 days" value={count(d.counts.expiring)} />
          <Kpi label="Products on offer" value={count(d.counts.productsOnOffer)} />
          <Kpi
            label="Sales with offer"
            value={money(d.current.offerSales)}
            delta={delta(d.current.offerSales, d.previousStats.offerSales)}
            highlight
          />
          <Kpi
            label="Orders with offer"
            value={count(d.current.offerOrders)}
            delta={delta(d.current.offerOrders, d.previousStats.offerOrders)}
          />
          <Kpi label="Share of product sales" value={pct(ratio(d.current.offerSales, d.current.sales))} />
        </>
      )}
      extra={d => (
        <Section title="Product offers">
          <Table
            rows={d.offers}
            rowKey={r => r.id}
            pageSize={10}
            empty="No product offers yet"
            cols={[
              {
                key: 'title',
                label: 'Offer',
                render: r => (
                  <Link href={ap(`/admin/offers/${r.id}`)} className="text-foreground hover:text-accent-500">
                    {r.title}
                  </Link>
                ),
              },
              { key: 'status', label: 'Status', render: r => <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge> },
              { key: 'ends', label: 'Ends', render: r => day(r.endsAt) },
              { key: 'products', label: 'Products', num: true, render: r => count(r.products) },
              { key: 'sales', label: 'Sales', num: true, render: r => money(r.sales), sort: r => r.sales },
              { key: 'chg', label: 'vs prev', num: true, render: r => pct(delta(r.sales, r.prevSales), 0) },
            ]}
          />
        </Section>
      )}
    />
  )
}
