import { Sk } from '@/components/admin/kit/skeleton'
import { LoadingAttention } from '../../products/_components/loading-parts'

const KPIS = ['Active members', 'Active in period', 'Sign-ins', 'MFA coverage']

/** Team overview body: the four KPI cards (two by two) beside the attention list. Server-safe. */
export default function TeamOverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="grid grid-cols-2 gap-3">
        {KPIS.map(l => (
          <div key={l} className="min-w-0 bg-surface-elevated border border-border-default rounded-xl p-3 sm:p-4 flex flex-col gap-1">
            <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium leading-tight">{l}</p>
            <Sk className="mt-1 h-6 w-20" />
          </div>
        ))}
      </div>
      <LoadingAttention />
    </div>
  )
}
