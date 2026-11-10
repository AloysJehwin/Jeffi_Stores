import { LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar, LoadingTabBar } from '../products/_components/loading-parts'
import ReviewFormsOverviewLoading from './_components/ReviewFormsOverviewLoading'

export default function Loading() {
  return (
    <PageLoading title="Review Forms" description="Shareable forms that reward customers for Google reviews">
      <LoadingTabBar tabs={['Overview', 'Forms', 'Drafts']} actions={1} />
      <div className="space-y-4">
        <LoadingPeriodBar />
        <LoadingToolbar filters={1} />
        <ReviewFormsOverviewLoading />
      </div>
    </PageLoading>
  )
}
