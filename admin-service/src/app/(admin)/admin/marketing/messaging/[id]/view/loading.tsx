import { PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { LoadingRecentChanges, LoadingTableCard } from '../../../../products/_components/loading-parts'

const card = 'rounded-xl border border-border-default bg-surface-elevated'

export default function Loading() {
  return (
    <PageLoading back="Messaging" description={<Sk className="mt-1 h-3.5 w-64" />}>
      {/* The first and last KPI labels depend on the message (Template / Channels, Sent / Scheduled / Created). */}
      <div className="kpi-grid">
        <div>
          {[null, 'Audience', 'Recipients', null].map((l, i) => (
            <div key={i} className={`flex min-w-0 flex-col gap-1 p-3 sm:p-4 ${card}`}>
              {l ? <p className="text-xs font-medium uppercase leading-tight tracking-wide text-foreground-muted">{l}</p> : <Sk className="h-3 w-16" />}
              <Sk className="mt-1 h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
      <LoadingTableCard title="Delivery log" columns={['Recipient', 'Status', 'Sent At', 'Detail']} rows={10} />
      <LoadingRecentChanges />
    </PageLoading>
  )
}
