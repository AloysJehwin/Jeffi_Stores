import { LoadingKpis, LoadingSection, Sk } from '@/components/admin/kit/skeleton'
import { LoadingAttention } from '../products/_components/loading-parts'

// Server-safe placeholders for the audit overview and log tabs.

/** Overview body: KPIs, then attention beside the by-member and by-action lists. */
export function AuditOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Actions logged', 'Members acting', 'Risky actions', 'Failed sign-ins']} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <LoadingAttention />
        <LoadingSection title="By member" lines={5} />
        <LoadingSection title="By action" lines={5} />
      </div>
    </>
  )
}

/** Log rows (events, emails, messages, cron jobs): status icon, a title line and meta lines. */
export function LogRowsSkeleton({ rows = 6, icon = true }: { rows?: number; icon?: boolean }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-surface-elevated border border-border-default rounded-lg p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
          {icon && <Sk className="w-9 h-9 rounded-full shrink-0" />}
          <div className="flex-1 min-w-0 space-y-2">
            <Sk className={`h-3.5 ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
            <Sk className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
