import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import OrdersOverviewSkeleton from './_components/OrdersOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Orders" description="Manage customer orders">
      <LoadingTabs tabs={['Overview', 'All orders']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <OrdersOverviewSkeleton />
    </PageLoading>
  )
}
