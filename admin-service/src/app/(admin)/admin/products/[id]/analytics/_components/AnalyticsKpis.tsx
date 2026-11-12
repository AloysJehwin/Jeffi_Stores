import { Kpi, KpiGrid, numStr } from '@/components/admin/kit'
import { rupees, type AnalyticsData } from './analytics'

export function AnalyticsKpis({ totals }: { totals: AnalyticsData['totals'] }) {
  return (
    <KpiGrid>
      <Kpi label="Views" value={numStr(totals.views)} sub={`${numStr(totals.uniqueViewers)} unique`} />
      <Kpi label="Cart Adds" value={numStr(totals.cartAdds)} sub={totals.activeCarts > 0 ? `${totals.activeCarts} active now` : undefined} />
      <Kpi label="Orders" value={numStr(totals.orders)} sub={`${numStr(totals.quantitySold)} units sold`} />
      <Kpi label="Revenue" value={rupees(totals.revenue)} sub={`₹${totals.revenuePerView}/view`} />
      <Kpi label="Conversion" value={`${totals.conversionRate}%`} sub={`${totals.cartConversionRate}% cart→order`} highlight={totals.conversionRate >= 5} />
    </KpiGrid>
  )
}
