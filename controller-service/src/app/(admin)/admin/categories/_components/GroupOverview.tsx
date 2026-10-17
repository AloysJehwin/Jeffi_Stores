'use client'

import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { Kpi, Section, Table, count, money, pct } from '@/components/admin/channels/ui'
import { delta } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { OverviewTab } from '../../products/_components/catalog-overview'

interface GroupRow {
  id: string
  name: string
  parentName: string | null
  activeProducts: number
  stockValue: number
  sales: number
  prevSales: number
  units: number
  margin: number | null
}

interface GroupOverviewData {
  totals: {
    groups: number
    active: number
    products: number
    stockValue: number
    sales: number
    prevSales: number
    empty: number
    unused: number
    unassigned: number
  }
  top: GroupRow[]
  attention: AttentionItem[]
}

/** Overview tab for the categories and brands pages. */
export default function GroupOverview({ dim }: { dim: 'category' | 'brand' }) {
  const base = dim === 'category' ? '/admin/categories' : '/admin/brands'
  const plural = dim === 'category' ? 'Categories' : 'Brands'
  return (
    <OverviewTab<GroupOverviewData>
      endpoint={`/api${base}/overview`}
      kpis={d => (
        <>
          <Kpi
            label={`Active ${plural.toLowerCase()}`}
            value={count(d.totals.active)}
            sub={`${count(d.totals.groups)} in total`}
          />
          <Kpi
            label="Active products"
            value={count(d.totals.products)}
            sub={d.totals.unassigned ? `${count(d.totals.unassigned)} with no ${dim}` : undefined}
          />
          <Kpi label="Stock value" value={money(d.totals.stockValue)} sub="at cost" />
          <Kpi
            label="Sales"
            value={money(d.totals.sales)}
            delta={delta(d.totals.sales, d.totals.prevSales)}
            highlight
          />
          <Kpi label="Empty" value={count(d.totals.empty)} sub="no products" />
          <Kpi label="Unused" value={count(d.totals.unused)} sub="no sale in 90 days" />
        </>
      )}
      extra={d => (
        <Section title={`Top ${plural.toLowerCase()} by sales`}>
          <Table
            rows={d.top}
            rowKey={r => r.id}
            pageSize={10}
            empty="No sales or stock yet"
            cols={[
              {
                key: 'name',
                label: dim === 'category' ? 'Category' : 'Brand',
                render: r => (
                  <Link href={ap(`${base}/${r.id}/view`)} className="text-foreground hover:text-accent-500">
                    {r.name}
                    {r.parentName && <span className="text-foreground-muted text-xs"> in {r.parentName}</span>}
                  </Link>
                ),
              },
              {
                key: 'products',
                label: 'Products',
                num: true,
                render: r => count(r.activeProducts),
                sort: r => r.activeProducts,
              },
              { key: 'stock', label: 'Stock', num: true, render: r => money(r.stockValue), sort: r => r.stockValue },
              { key: 'sales', label: 'Sales', num: true, render: r => money(r.sales), sort: r => r.sales },
              { key: 'chg', label: 'vs prev', num: true, render: r => pct(delta(r.sales, r.prevSales), 0) },
              { key: 'margin', label: 'Margin', num: true, render: r => pct(r.margin, 0) },
            ]}
          />
        </Section>
      )}
    />
  )
}
