import { LoadingTabs, LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { LoadingPeriodBar } from '../products/_components/loading-parts'
import { TasksOverviewSkeleton } from './TasksLoadingParts'

export default function Loading() {
  return (
    <PageLoading title="Tasks" description="Customer follow-ups assigned to you and the team">
      <div className="space-y-4">
        <LoadingTabs tabs={['Overview', 'Tasks']} />
        <div className="pt-1 space-y-3">
          <LoadingPeriodBar />
          <LoadingToolbar filters={2} />
          <TasksOverviewSkeleton />
        </div>
      </div>
    </PageLoading>
  )
}
