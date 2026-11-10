import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import CustomersOverviewSkeleton from './_components/CustomersOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Customers" description="View and manage customer accounts">
      <LoadingTabs tabs={['Overview', 'Customers']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <CustomersOverviewSkeleton />
    </PageLoading>
  )
}
