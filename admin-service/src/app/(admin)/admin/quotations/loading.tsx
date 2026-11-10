import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import QuotationsOverviewSkeleton from './_components/QuotationsOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Quotations" description="Create and manage B2B quotations">
      <LoadingTabs tabs={['Overview', 'Quotations', 'Drafts']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <QuotationsOverviewSkeleton />
    </PageLoading>
  )
}
