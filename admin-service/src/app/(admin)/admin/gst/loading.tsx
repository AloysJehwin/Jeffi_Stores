import { LoadingTabs, PageLoading, Sk } from '@/components/admin/kit/skeleton'
import { GstKpisSkeleton, GstTabSkeleton } from './_components/GstSkeleton'

export default function Loading() {
  return (
    <PageLoading title="GST Compliance" description="GSTR-1 · GSTR-3B · e-Invoice status · ITC Ledger" actions={1}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex h-control max-w-full items-center overflow-x-auto rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {['This Month', 'Last Month', 'This Quarter', 'Custom'].map((p, i) => (
            <span key={p} className={`flex h-full shrink-0 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium ${i === 0 ? 'bg-accent-500 text-white' : 'text-foreground-secondary'}`}>
              {p}
            </span>
          ))}
        </div>
        {['From', 'To'].map(l => (
          <div key={l}>
            <p className="mb-1.5 text-xs font-medium text-foreground-secondary">{l}</p>
            <Sk className="h-control w-36 rounded-lg" />
          </div>
        ))}
        <Sk className="h-control w-32 rounded-lg" />
      </div>
      <GstKpisSkeleton />
      <LoadingTabs tabs={['GSTR-1', 'GSTR-3B', 'e-Invoice / IRN', 'ITC Ledger']} />
      <GstTabSkeleton tab="gstr1" />
    </PageLoading>
  )
}
