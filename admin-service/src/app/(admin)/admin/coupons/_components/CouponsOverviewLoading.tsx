import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection } from '@/components/admin/kit/skeleton'
import { LoadingAttention, LoadingTableCard } from '../../products/_components/loading-parts'

/** The coupons overview body (below the period bar and filters) while its data loads. */
export default function CouponsOverviewLoading() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Redemptions', 'Discount given', 'Revenue with coupon', 'Discount rate', 'Orders with coupon', 'Active coupons']} />
      <LoadingAttention />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadingChart title="Redemptions and discount" />
        </div>
        <LoadingSection title="By source">
          <LoadingLines lines={5} />
        </LoadingSection>
      </div>
      <LoadingTableCard title="Top coupons" columns={['Code', 'Source', 'Uses', 'Customers', 'Discount', 'Revenue']} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LoadingTableCard title="Expiring within 7 days" columns={['Code', 'Expires', 'Used']} rows={4} />
        <LoadingTableCard title="Never used (14+ days)" columns={['Code', 'Created']} rows={4} />
      </div>
    </div>
  )
}
