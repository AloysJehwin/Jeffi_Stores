import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import DelhiveryOverviewSkeleton from './_components/DelhiveryOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Delhivery" description="Shipments, deliveries, pickups and COD remittance" back="Orders">
      <div className="space-y-5">
        <LoadingTabs tabs={['Overview', 'Pickup requests']} />
        <div className="space-y-4">
          <Sk className="h-control w-full max-w-2xl rounded-lg" />
          <DelhiveryOverviewSkeleton />
        </div>
      </div>
    </PageLoading>
  )
}
