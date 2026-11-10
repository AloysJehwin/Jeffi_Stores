import { PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar, LoadingTabBar } from '../products/_components/loading-parts'
import InflationOverviewSkeleton from './_components/InflationOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading
      title="Price Inflation"
      description="Bulk-increase MRP (ex-GST) by percentage. All derived prices (MRP incl. GST, selling price, wholesale) are recalculated from each product's discount % and GST rate."
    >
      <div className="mb-6">
        <LoadingTabBar tabs={['Overview', 'Apply and history']} />
      </div>
      <div className="space-y-4">
        <LoadingPeriodBar />
        <InflationOverviewSkeleton />
      </div>
    </PageLoading>
  )
}
