import { PageLoading, LoadingTabs } from '@/components/admin/kit/skeleton'
import TrafficTabLoading, { PeriodBarLoading } from './_components/TrafficLoading'

export default function Loading() {
  return (
    <PageLoading title="Traffic" description="Visitors, where they come from and what they do">
      <LoadingTabs tabs={['Overview', 'Acquisition', 'Behaviour', 'Funnel', 'Products', 'Search', 'Audience', 'Real-time']} active={0} />
      <PeriodBarLoading />
      <TrafficTabLoading tab="overview" />
    </PageLoading>
  )
}
