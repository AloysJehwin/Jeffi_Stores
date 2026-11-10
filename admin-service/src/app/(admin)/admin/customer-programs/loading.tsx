import { PageLoading, LoadingTabs } from '@/components/admin/kit/skeleton'
import { PeriodBarLoading, ProgramsOverviewLoading } from './_components/ProgramsLoading'

export default function Loading() {
  return (
    <PageLoading title="Programs" description="Rewards that keep customers coming back. Switch each one on or off in Site Controls.">
      <LoadingTabs tabs={['Overview', 'Loyalty', 'Refer & Earn', 'Birthday rewards']} active={0} />
      <div className="space-y-4">
        <PeriodBarLoading />
        <ProgramsOverviewLoading />
      </div>
    </PageLoading>
  )
}
