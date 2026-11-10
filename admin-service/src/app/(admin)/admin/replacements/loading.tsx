import { LoadingTabs, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import ReplacementsOverviewSkeleton from './_components/ReplacementsOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Replacements" description="Replacement rate, reasons and time to close, and the replacement orders created from approved return requests">
      <div className="space-y-5">
        <LoadingTabs tabs={['Overview', 'Replacement requests']} />
        <div className="space-y-4">
          <Sk className="h-control w-full max-w-2xl rounded-lg" />
          <LoadingToolbar filters={3} />
          <ReplacementsOverviewSkeleton />
        </div>
      </div>
    </PageLoading>
  )
}
