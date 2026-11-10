import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import ShelvingOverviewSkeleton from './ShelvingOverviewSkeleton'

export default function Loading() {
  return (
    <PageLoading title="Shelving" description="Warehouse, location and stock placement">
      <LoadingTabs tabs={['Overview', 'Locations']} />
      <div className="space-y-3">
        <Sk className="h-control w-full max-w-2xl rounded-lg" />
        <ShelvingOverviewSkeleton />
      </div>
    </PageLoading>
  )
}
