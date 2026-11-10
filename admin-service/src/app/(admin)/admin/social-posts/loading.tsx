import { PageLoading, LoadingTabs, LoadingSection } from '@/components/admin/kit/skeleton'
import { CalendarGridLoading } from './loading-parts'

export default function Loading() {
  const month = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  return (
    <PageLoading
      title="Social"
      description="Plan, publish and measure posts across Facebook, Instagram, Business Profile, YouTube, Pinterest, LinkedIn and X"
      actions={1}
    >
      <div className="space-y-4">
        <LoadingTabs tabs={['Calendar', 'Compose', 'Approvals', 'Inbox', 'Insights', 'Accounts', 'Library', 'Alerts and history']} active={0} />
        <LoadingSection title={month}>
          <CalendarGridLoading />
        </LoadingSection>
      </div>
    </PageLoading>
  )
}
