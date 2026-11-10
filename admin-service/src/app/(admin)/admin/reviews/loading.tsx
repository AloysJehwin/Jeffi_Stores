import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import ReviewsOverviewSkeleton from './_components/ReviewsOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Reviews" description="Ratings, review requests and moderation of customer reviews before they appear on product pages">
      <LoadingTabs tabs={['Overview', 'Reviews']} />
      <div className="space-y-4">
        <Sk className="h-control w-full max-w-2xl rounded-lg" />
        <LoadingToolbar filters={2} />
        <ReviewsOverviewSkeleton />
      </div>
    </PageLoading>
  )
}
