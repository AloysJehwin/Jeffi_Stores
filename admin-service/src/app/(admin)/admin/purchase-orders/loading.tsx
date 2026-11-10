import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import PurchaseOrdersOverviewSkeleton from './_components/PurchaseOrdersOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Purchase Orders" description="Raise, track and receive purchase orders">
      <LoadingTabs tabs={['Overview', 'Purchase orders', 'Drafts']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <PurchaseOrdersOverviewSkeleton />
    </PageLoading>
  )
}
