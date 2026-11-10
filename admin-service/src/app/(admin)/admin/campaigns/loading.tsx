import { PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar, LoadingTabBar } from '../products/_components/loading-parts'
import CampaignsOverviewLoading from './_components/CampaignsOverviewLoading'

export default function Loading() {
  return (
    <PageLoading title="Campaigns" description="Automated marketing campaigns triggered by customer behavior">
      <LoadingTabBar tabs={['Overview', 'Campaigns', 'Scenarios', 'Drafts']} />
      <div className="space-y-4">
        <LoadingPeriodBar />
        <CampaignsOverviewLoading />
      </div>
    </PageLoading>
  )
}
