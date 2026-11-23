import { LoadingTabs } from '@/components/admin/kit/skeleton'
import { ConsoleLoading } from '../../../_components/Skeleton'
import AnalyticsTabLoading from './_components/AnalyticsLoading'

export default function Loading() {
  return (
    <ConsoleLoading eyebrow="Showcase analytics">
      <div className="space-y-5">
        <LoadingTabs tabs={['Overview', 'Acquisition', 'Behaviour', 'Funnel', 'Leads', 'Audience', 'Real-time']} />
        <AnalyticsTabLoading tab="overview" />
      </div>
    </ConsoleLoading>
  )
}
