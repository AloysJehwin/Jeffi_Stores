'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Empty, Kpi, KpiGrid, Section, Table, count, inputCls, money, type Col } from '@/components/admin/channels/ui'
import type { ProductRow, ProductsData } from '@/lib/traffic/types'
import { HBars } from './charts'
import { Note, productHref, rateText, ratio } from './shared'

const name = (id: string, n: string) => (
  <Link href={productHref(id)} className="hover:text-accent-600">
    {n}
  </Link>
)

export default function ProductsTab({ data }: { data: ProductsData }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? data.products.filter(p => p.name.toLowerCase().includes(s) || p.slug.includes(s)) : data.products
  }, [data.products, q])

  if (!data.products.length && !data.wishlisted.length && !data.backInStock.length)
    return <Empty msg="No product views, cart adds or orders in this period yet." />

  const sum = (f: (p: ProductRow) => number) => data.products.reduce((s, p) => s + f(p), 0)
  const views = sum(p => p.views)
  const adds = sum(p => p.cartAdds)
  const orders = sum(p => p.orders)

  const cols: Col<ProductRow>[] = [
    { key: 'name', label: 'Product', sort: r => r.name, render: r => <span className="block max-w-[260px]">{name(r.productId, r.name)}</span> },
    { key: 'views', label: 'Views', num: true, sort: r => r.views, render: r => count(r.views) },
    { key: 'uniq', label: 'Viewers', num: true, sort: r => r.uniqueViewers, render: r => count(r.uniqueViewers) },
    { key: 'adds', label: 'Cart adds', num: true, sort: r => r.cartAdds, render: r => count(r.cartAdds) },
    { key: 'orders', label: 'Orders', num: true, sort: r => r.orders, render: r => count(r.orders) },
    { key: 'units', label: 'Units', num: true, sort: r => r.units, render: r => count(r.units) },
    { key: 'revenue', label: 'Revenue', num: true, sort: r => r.revenue, render: r => money(r.revenue) },
    { key: 'v2c', label: 'View to cart', num: true, sort: r => ratio(r.cartAdds, r.views) ?? -1, render: r => rateText(r.cartAdds, r.views) },
    { key: 'c2o', label: 'Cart to order', num: true, sort: r => ratio(r.orders, r.cartAdds) ?? -1, render: r => rateText(r.orders, r.cartAdds) },
    { key: 'v2o', label: 'View to order', num: true, sort: r => ratio(r.orders, r.views) ?? -1, render: r => rateText(r.orders, r.views) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Products viewed" value={count(data.products.filter(p => p.views > 0).length)} />
        <Kpi label="Product views" value={count(views)} />
        <Kpi label="Cart adds" value={count(adds)} sub={`${rateText(adds, views)} of views`} />
        <Kpi label="Product orders" value={count(orders)} sub={`${rateText(orders, views, 2)} of views`} />
        <Kpi label="Revenue" value={money(sum(p => p.revenue))} />
        <Kpi label="Units" value={count(sum(p => p.units))} />
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Opportunities: viewed, rarely bought">
          <HBars
            color="rgba(249,115,22,0.6)"
            empty="No product has 20+ views with under 1% ordering"
            rows={data.opportunities.map(p => ({ key: p.productId, label: name(p.productId, p.name), value: p.views, right: `${count(p.views)} views · ${count(p.orders)} orders` }))}
          />
        </Section>
        <Section title="Promote: converts well, few views">
          <HBars
            color="rgba(34,197,94,0.6)"
            empty="No product converts at 5%+ on low traffic yet"
            rows={data.promote.map(p => ({ key: p.productId, label: name(p.productId, p.name), value: p.orders, right: `${rateText(p.orders, p.views)} of ${count(p.views)} views` }))}
          />
        </Section>
        <Section title="Most wishlisted">
          <HBars
            color="rgba(236,72,153,0.6)"
            empty="Nothing on wishlists"
            rows={data.wishlisted.map(p => ({ key: p.productId, label: name(p.productId, p.name), value: p.count }))}
          />
        </Section>
        <Section title="Back-in-stock requests waiting">
          <HBars
            color="rgba(59,130,246,0.6)"
            empty="No one is waiting for a restock"
            rows={data.backInStock.map(p => ({ key: p.productId, label: name(p.productId, p.name), value: p.count }))}
          />
        </Section>
      </div>

      <Section
        title="All products"
        action={<input className={`${inputCls} !w-56`} placeholder="Search products" value={q} onChange={e => setQ(e.target.value)} aria-label="Search products" />}
      >
        <Table rows={rows} cols={cols} rowKey={r => r.productId} empty={q ? 'No product matches' : 'No product activity'} />
      </Section>
      <Note>
        Orders, units and revenue count online orders that were not cancelled or left unpaid. Cart adds are items
        added to carts saved on the server. Wishlists and back-in-stock requests are current totals.
      </Note>
    </div>
  )
}
