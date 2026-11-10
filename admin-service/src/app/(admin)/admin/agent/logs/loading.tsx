import { LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { LogRowsSkeleton } from '../_components/AgentLoadingParts'

export default function Loading() {
  return (
    <PageLoading
      title="Agent Tool Logs"
      description="Tool calls made by the AI admin assistant. Each row is one assistant response that invoked one or more tools."
      actions={1}
    >
      <LoadingToolbar filters={2} />
      <LogRowsSkeleton />
    </PageLoading>
  )
}
