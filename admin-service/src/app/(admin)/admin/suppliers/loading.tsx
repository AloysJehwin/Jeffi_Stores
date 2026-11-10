import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import SuppliersOverviewSkeleton from './_components/SuppliersOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Suppliers" description="Purchasing, deliveries and what you owe suppliers">
      <LoadingTabs tabs={['Overview', 'Suppliers', 'Drafts']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <SuppliersOverviewSkeleton />
    </PageLoading>
  )
}
