import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import B2bCustomersOverviewSkeleton from './_components/B2bCustomersOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Business Customers" description="Manage B2B partner accounts, approvals, and discounts">
      <LoadingTabs tabs={['Overview', 'All accounts']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <B2bCustomersOverviewSkeleton />
    </PageLoading>
  )
}
