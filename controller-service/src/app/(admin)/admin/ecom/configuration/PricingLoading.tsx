import { Sk } from '@/components/admin/kit/skeleton'
import type { PricingSettings } from '@/lib/compute/spec'

export const SETTINGS: { key: keyof PricingSettings; label: string; step: string }[] = [
  { key: 'usdInr', label: 'USD → INR', step: '0.01' },
  { key: 'gstRate', label: 'GST rate', step: '0.01' },
  { key: 'platformShareUsd', label: 'Platform share per store (USD/month)', step: '0.5' },
  { key: 'rootVolumeGb', label: 'Server disk (GB)', step: '1' },
  { key: 'poolCapacity', label: 'Starter stores per shared server', step: '1' },
  { key: 'sharedDbCapacity', label: 'Starter stores per shared database', step: '1' },
  { key: 'sharedDbStorageGb', label: 'Starter database storage (GB)', step: '1' },
  { key: 'sharedDbMaxConnections', label: 'Shared database connections', step: '10' },
  { key: 'minPrepayDays', label: 'Days of servers paid upfront', step: '1' },
  { key: 'graceDays', label: 'Grace days on a negative wallet', step: '1' },
  { key: 'ipv4UsdHour', label: 'IPv4 (USD/hour)', step: '0.0001' },
  { key: 'ebsGp3UsdGbMonth', label: 'EBS gp3 (USD/GB-month)', step: '0.001' },
  { key: 'snapshotUsdGbMonth', label: 'Snapshots (USD/GB-month)', step: '0.001' },
  { key: 's3UsdGbMonth', label: 'S3 (USD/GB-month)', step: '0.001' },
]

const box = 'overflow-x-auto rounded-xl border border-border-default bg-surface-elevated'
const th = 'px-4 py-3 font-medium'
const align = { left: 'text-left', right: 'text-right', center: 'text-center' }

function TableLoading({ heads, rows }: { heads: [string, 'left' | 'right' | 'center'][]; rows: number }) {
  return (
    <section className={box}>
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-foreground-muted">
          <tr>{heads.map(([h, a], i) => <th key={i} className={`${th} ${align[a]}`}>{h || <Sk className="ml-auto h-3.5 w-24" />}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {heads.map(([, a], c) => (
                <td key={c} className="px-4 py-3">
                  <Sk className={`h-3.5 ${c === 0 ? 'w-28' : a === 'center' ? 'mx-auto w-4' : 'ml-auto w-16'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Server pricing while it loads: margins, the size and plan tables, settings and the price list. */
export function PricingLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading server pricing">
      <section className="rounded-xl border border-border-default bg-surface-elevated p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Margins</h2>
        <p className="mt-0.5 text-xs text-foreground-muted">
          Markup on the AWS cost of a store&apos;s whole infrastructure. Its plan&apos;s server margin applies with the database on its own
          server, the RDS margin with RDS (blank: the server margin). Examples are the monthly price with GST and the plan fee.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 border-b border-border-default pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <div className="text-sm text-foreground">Default margin</div>
            <div className="text-xs text-foreground-muted">For plans without a margin of their own</div>
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs text-foreground-muted">All plans</span>
            <Sk className="h-control w-full rounded-lg" />
          </div>
        </div>
        <div className="divide-y divide-border-default">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <Sk className="h-3.5 w-24" />
                <Sk className="h-3 w-16" />
              </div>
              <div className="space-y-1.5">
                <span className="block text-xs text-foreground-muted">On its own server</span>
                <Sk className="h-control w-full rounded-lg" />
              </div>
              <div className="space-y-1.5">
                <span className="block text-xs text-foreground-muted">With RDS</span>
                <Sk className="h-control w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <TableLoading heads={[['Size', 'left'], ['AWS cost / month', 'right'], ['', 'right'], ['', 'right'], ['', 'right']]} rows={6} />
      <TableLoading heads={[['Plan', 'left'], ['Minimum size', 'left'], ['Plan fee / month (incl. GST)', 'right']]} rows={4} />
      <section className="rounded-xl border border-border-default bg-surface-elevated p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTINGS.map(s => (
            <div key={s.key}>
              <span className="mb-1 block text-xs text-foreground-muted">{s.label}</span>
              <Sk className="h-control w-full rounded-lg" />
            </div>
          ))}
        </div>
      </section>
      <TableLoading heads={[['Resource', 'left'], ['USD / hour', 'right'], ['Multi-AZ / hour', 'right'], ['USD / GB-month', 'right'], ['Multi-AZ / GB-month', 'right'], ['Offered', 'center']]} rows={6} />
    </div>
  )
}
