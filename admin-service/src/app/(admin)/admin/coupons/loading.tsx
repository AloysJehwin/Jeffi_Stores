import { LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar, LoadingTabBar } from '../products/_components/loading-parts'
import CouponsOverviewLoading from './_components/CouponsOverviewLoading'

export default function Loading() {
  return (
    <PageLoading title="Coupons" description="Manage discount coupons">
      <LoadingTabBar tabs={['Overview', 'Coupons', 'Drafts']} actions={1} />
      <div className="space-y-4">
        <LoadingPeriodBar />
        <LoadingToolbar filters={1} />
        <CouponsOverviewLoading />
      </div>
    </PageLoading>
  )
}
