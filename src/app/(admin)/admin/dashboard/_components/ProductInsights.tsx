'use client'

import Link from 'next/link'
import { useHasScope } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { DashboardAnalytics } from '@/lib/queries'
import { RankedBars } from '@/components/admin/dashboard/Charts'
import {
  SectionCard,
  SectionHeader,
  CompactStat,
  MiniStat,
  Chip,
  rs,
  rsCompact,
  pctStr,
  numStr,
} from '@/components/admin/dashboard/Primitives'

function convTone(v: number | null): 'neutral' | 'good' | 'warn' | 'bad' {
  if (v == null) return 'neutral'
  if (v >= 5) return 'good'
  if (v >= 1) return 'warn'
  return 'bad'
}

export default function ProductInsights({ data, host }: { data: DashboardAnalytics; host: string }) {
  const { catalog: c, attention: a, engagement: e, money, topViewed, marginByProduct } = data.insights
  const canInventory = useHasScope('inventory:read')
  const canFinancial = useHasScope('financial:read')
  const canTraffic = useHasScope('traffic:read')
  const soldShare = c.activeProducts > 0 ? Math.round((c.productsSold / c.activeProducts) * 100) : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
      <SectionCard>
        <SectionHeader title="Catalog Health" actionLabel="Products" href={ap('/admin/products', host)} />
        <div className="grid grid-cols-2 gap-2">
          <CompactStat label="Active products" value={numStr(c.activeProducts)} href={ap('/admin/products', host)} />
          <CompactStat label="Sold in range" value={numStr(c.productsSold)} sub={`${soldShare}% of catalog`} />
          <CompactStat label="New products" value={numStr(c.newProducts)} sub="published in range" />
          <CompactStat
            label="Drafts"
            value={numStr(c.draftProducts)}
            sub="not yet published"
            tone={c.draftProducts ? 'text-amber-600 dark:text-amber-400' : undefined}
            href={ap('/admin/products', host)}
          />
        </div>
        {canInventory && (
          <div className="mt-3 pt-3 border-t border-border-default space-y-0.5">
            <MiniStat
              label="Slow movers (no sales, in stock)"
              value={numStr(c.slowMovers)}
              sub={c.slowMovers ? `${rsCompact(c.slowMoverValue)} tied up` : undefined}
              tone={c.slowMovers ? 'text-amber-600 dark:text-amber-400' : undefined}
              href={ap('/admin/inventory', host)}
            />
            <MiniStat
              label="Restock within 7 days"
              value={numStr(a.restockSoon)}
              sub="at current sell rate"
              tone={a.restockSoon ? 'text-red-500 dark:text-red-400' : undefined}
              href={ap('/admin/inventory', host)}
            />
            <MiniStat
              label="Selling but out of stock"
              value={numStr(a.sellingButOut)}
              tone={a.sellingButOut ? 'text-red-500 dark:text-red-400' : undefined}
              href={ap('/admin/inventory', host)}
            />
            <MiniStat
              label="Expiring in 30 days"
              value={numStr(a.expiringBatches)}
              sub={a.expiringBatches ? `${numStr(Math.round(c.expiringQty))} units across batches` : undefined}
              tone={a.expiringBatches ? 'text-amber-600 dark:text-amber-400' : undefined}
              href={ap('/admin/inventory', host)}
            />
            <MiniStat
              label="Expired batches on hand"
              value={numStr(a.expiredBatches)}
              tone={a.expiredBatches ? 'text-red-500 dark:text-red-400' : undefined}
              href={ap('/admin/inventory', host)}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader
          title="Most Viewed vs Bought"
          actionLabel={canTraffic ? 'Traffic' : undefined}
          href={canTraffic ? ap('/admin/traffic', host) : undefined}
        />
        {topViewed.length === 0 ? (
          <p className="text-xs text-foreground-muted py-4 text-center">No product views recorded in this range.</p>
        ) : (
          <div className="divide-y divide-border-default">
            {topViewed.map(p => (
              <Link
                key={p.id}
                href={ap(`/admin/products/edit/${p.id}`, host)}
                className="flex items-center gap-3 py-2 group hover:bg-surface-secondary rounded-md px-1 -mx-1 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate group-hover:text-accent-600 transition-colors">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-foreground-muted tabular-nums">
                    {numStr(p.views)} views, {numStr(Math.round(p.units))} sold, {rs(p.revenue)}
                  </p>
                </div>
                <Chip tone={convTone(p.conversion)}>{p.conversion == null ? 'n/a' : `${p.conversion}% conv`}</Chip>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader
          title={canFinancial ? 'Margin by Top Product' : 'Top Sellers by Revenue'}
          actionLabel="Products"
          href={ap('/admin/products', host)}
        />
        <RankedBars
          barClass="bg-emerald-500"
          items={marginByProduct.map(m => ({
            name: m.name,
            value: m.revenue,
            sub: canFinancial && m.marginPct != null ? `${rs(m.revenue)}, ${m.marginPct}% margin` : rs(m.revenue),
          }))}
        />
        {canFinancial && marginByProduct.length > 0 && (
          <p className="text-[11px] text-foreground-muted mt-3">
            {money.costCoveragePct == null || money.costCoveragePct >= 100
              ? 'Margins use the cost price on each variant or product.'
              : `Cost price is set on ${money.costCoveragePct}% of units sold. Add cost prices to complete the picture.`}
          </p>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Demand Signals" />
        <div className="space-y-0.5">
          <MiniStat label="Wishlist adds" value={numStr(e.wishlistAdds)} sub="in range" />
          <MiniStat
            label="Back-in-stock waitlist"
            value={numStr(a.backInStockWaitlist)}
            sub="customers waiting"
            tone={a.backInStockWaitlist ? 'text-amber-600 dark:text-amber-400' : undefined}
            href={canInventory ? ap('/admin/inventory', host) : undefined}
          />
          <MiniStat label="Site searches" value={numStr(e.searches)} sub="in range" />
          <MiniStat
            label="Searches with no results"
            value={numStr(e.zeroResultSearches)}
            sub={e.searches ? `${pctStr((e.zeroResultSearches / e.searches) * 100, 0)} of searches` : undefined}
            tone={e.zeroResultSearches ? 'text-red-500 dark:text-red-400' : undefined}
          />
        </div>
        {e.topZeroSearches.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border-default">
            <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-1.5">
              Customers looked for
            </p>
            <div className="flex flex-wrap gap-1.5">
              {e.topZeroSearches.map(z => (
                <Chip key={z.query}>
                  {z.query} x{z.count}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
