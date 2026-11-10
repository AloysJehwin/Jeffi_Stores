import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/admin/kit/layout'
import { Sk } from '@/components/admin/kit/skeleton'
import { ToolCardsSkeleton } from '../_components/AgentLoadingParts'

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto" role="status" aria-busy="true" aria-label="Loading Proposed Tools">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <PageHeader title="Proposed Tools" media={<Sparkles className="w-5 h-5 text-accent-500" />} />
        <Sk className="h-control-sm w-32 rounded-lg" />
      </div>
      <p className="text-xs text-foreground-muted mb-4">
        New admin-agent capabilities proposed by the LLM. <strong>Approving here makes them callable</strong> by the
        admin agent — every individual invocation will still go through the normal action approval queue.
      </p>
      <ToolCardsSkeleton />
    </div>
  )
}
