import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import SubscriptionsOverviewSkeleton from './_components/SubscriptionsOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Subscriptions" description="Recurring orders billed through Razorpay mandates">
      <LoadingTabs tabs={['Overview', 'Subscriptions']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <SubscriptionsOverviewSkeleton />
    </PageLoading>
  )
}
