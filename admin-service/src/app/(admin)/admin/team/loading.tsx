import { LoadingTabs, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar } from '../products/_components/loading-parts'
import TeamOverviewSkeleton from './_components/TeamOverviewSkeleton'

// The Settings hub on its Team tab, Overview open.
export default function Loading() {
  return (
    <PageLoading title="Settings" description="Your account, team, service accounts, CLI tokens and the audit log">
      <LoadingTabs tabs={['Account', 'Team', 'Service accounts', 'CLI & tokens', 'Audit log']} active={1} />
      <div className="space-y-6">
        <LoadingTabs tabs={['Overview', 'Members']} />
        <div className="pt-1 space-y-3">
          <LoadingPeriodBar />
          <TeamOverviewSkeleton />
        </div>
      </div>
    </PageLoading>
  )
}
