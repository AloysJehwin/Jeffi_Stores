import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import RfqsOverviewSkeleton from './_components/RfqsOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Business RFQs" description="Review and respond to quote requests from business partners">
      <LoadingTabs tabs={['Overview', 'All RFQs', 'Draft replies']} />
      <Sk className="h-control w-full max-w-2xl rounded-lg" />
      <LoadingToolbar filters={2} />
      <RfqsOverviewSkeleton />
    </PageLoading>
  )
}
