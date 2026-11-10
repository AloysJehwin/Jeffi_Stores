import { LoadingChart, LoadingKpis, LoadingLines, LoadingSection, Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status" aria-busy="true" aria-label="Loading product analytics">
      <header className="space-y-1.5">
        <Sk className="h-3.5 w-28" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Sk className="my-1 h-7 w-56" />
            <p className="mt-0.5 text-sm text-foreground-muted">Product analytics</p>
          </div>
          <div className="inline-flex h-control items-center gap-0.5 rounded-lg bg-surface-secondary p-0.5 text-sm">
            <span className="inline-flex h-full items-center rounded-md px-3 font-medium text-foreground-muted">Overview</span>
            <span className="inline-flex h-full items-center rounded-md bg-surface-elevated px-3 font-medium text-foreground shadow">Analytics</span>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Sk className="h-3.5 w-64" />
        <div className="inline-flex h-control items-center gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
          {[7, 14, 30, 60, 90].map(d => (
            <span key={d} className={`flex h-full items-center rounded-md px-3 text-xs font-semibold ${d === 30 ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
              {d}d
            </span>
          ))}
        </div>
      </div>
      <LoadingKpis labels={['Views', 'Cart Adds', 'Orders', 'Revenue', 'Conversion']} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadingChart title="Traffic" />
        </div>
        <LoadingSection title="Top Referrers" lines={5} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <LoadingSection title="Variant Breakdown">
          <LoadingLines lines={4} />
        </LoadingSection>
        <LoadingSection title="Recent Buyers">
          <LoadingLines lines={4} />
        </LoadingSection>
      </div>
    </div>
  )
}
