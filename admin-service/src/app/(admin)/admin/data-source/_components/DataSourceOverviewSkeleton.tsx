import { LoadingKpis, LoadingLines, LoadingSection } from '@/components/admin/kit/skeleton'

/** The Data source overview tab while it loads. */
export default function DataSourceOverviewSkeleton() {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={['Products in catalogue', 'Created or updated (30d)', 'Last file import', 'Last sheet sync', 'Skipped rows (30d)', 'Google Sheet']} />
      <LoadingSection title="Needs attention" lines={3} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">Upload a file</p>
          <p className="text-sm text-foreground-muted">Download the template, fill it in and upload. New SKUs are created; existing ones are updated.</p>
          <p className="text-sm text-accent-500">Open Import</p>
        </div>
        <div className="bg-surface-elevated border border-border-default rounded-xl p-4 flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">Google Sheet sync</p>
          <LoadingLines lines={2} />
        </div>
      </div>
    </div>
  )
}
