import { LoadingTabs, LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar } from '../products/_components/loading-parts'
import { AuditOverviewSkeleton } from './AuditLoadingParts'

// The Settings hub on its Audit log tab, Overview open.
export default function Loading() {
  return (
    <PageLoading title="Settings" description="Your account, team, service accounts, CLI tokens and the audit log">
      <LoadingTabs tabs={['Account', 'Team', 'Service accounts', 'CLI & tokens', 'Audit log']} active={4} />
      <LoadingTabs tabs={['Overview', 'Audit log']} />
      <div className="space-y-3">
        <LoadingPeriodBar />
        <LoadingToolbar filters={2} />
        <AuditOverviewSkeleton />
      </div>
    </PageLoading>
  )
}
