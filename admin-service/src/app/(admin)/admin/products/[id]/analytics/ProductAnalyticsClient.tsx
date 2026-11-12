'use client'

import { AnalyticsKpis } from './_components/AnalyticsKpis'
import { AnalyticsToolbar } from './_components/AnalyticsToolbar'
import { PreviewCard } from './_components/PreviewCard'
import { TrafficCard } from './_components/TrafficCard'
import { BuyerRow, ReferrerRow, VariantTable } from './_components/rows'
import { useProductAnalytics } from './_components/useProductAnalytics'
import type { AnalyticsData } from './_components/analytics'

export default function ProductAnalyticsClient({ productId, initial }: { productId: string; initial: AnalyticsData }) {
  const { data, days, loading, changeRange } = useProductAnalytics(productId, initial)
  const range = `last ${days} days`

  return (
    <div className="space-y-5">
      <AnalyticsToolbar product={data.product} days={days} loading={loading} onRange={changeRange} />
      <AnalyticsKpis totals={data.totals} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <TrafficCard series={data.timeSeries} />
        </div>
        <PreviewCard
          title="Top Referrers"
          rows={data.referrers}
          empty="No referrer data yet."
          summary={`${data.referrers.length} sources · ${range}`}
          preview={(rows, more) => (
            <div className="space-y-2.5">
              {rows.map(r => (
                <ReferrerRow key={r.referrer} r={r} />
              ))}
              {more}
            </div>
          )}
          full={rows => (
            <div className="space-y-2.5 py-1">
              {rows.map(r => (
                <ReferrerRow key={r.referrer} r={r} />
              ))}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PreviewCard
          title="Variant Breakdown"
          rows={data.variantBreakdown}
          empty="No paid orders in this range."
          summary={`${data.variantBreakdown.length} variants · ${range}`}
          moreClassName="pt-2.5 pb-0.5"
          preview={(rows, more) => (
            <div className="overflow-x-auto">
              <VariantTable rows={rows} />
              {more}
            </div>
          )}
          full={rows => (
            <div className="overflow-x-auto">
              <VariantTable rows={rows} />
            </div>
          )}
        />
        <PreviewCard
          title="Recent Buyers"
          rows={data.recentBuyers}
          empty="No buyers yet."
          summary={`${data.recentBuyers.length} orders · ${range}`}
          preview={(rows, more) => (
            <div className="space-y-2.5">
              {rows.map((b, i) => (
                <BuyerRow key={`${b.orderNumber}-${b.createdAt}-${i}`} b={b} />
              ))}
              {more}
            </div>
          )}
          full={rows => (
            <div className="divide-y divide-border-default">
              {rows.map((b, i) => (
                <BuyerRow key={`${b.orderNumber}-${b.createdAt}-${i}`} b={b} large />
              ))}
            </div>
          )}
        />
      </div>
    </div>
  )
}
