import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import ReturnsOverviewSkeleton from './_components/ReturnsOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Returns" description="Return rate, reasons and refunds, and the active requests to review, track and valuate">
      <div className="space-y-5">
        <LoadingTabs tabs={['Overview', 'Return requests']} />
        <div className="space-y-4">
          <Sk className="h-control w-full max-w-2xl rounded-lg" />
          <LoadingToolbar filters={3} />
          <ReturnsOverviewSkeleton />
        </div>
      </div>
    </PageLoading>
  )
}
