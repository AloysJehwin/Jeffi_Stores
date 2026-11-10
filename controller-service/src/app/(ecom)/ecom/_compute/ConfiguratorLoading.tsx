import { Sk } from '@/components/admin/kit/skeleton'

/** ComputeConfigurator's shape while its prices load: the plan cards and the server panel. */
export function ConfiguratorLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading server prices">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-border-default bg-surface-elevated p-4">
            <Sk className="h-4 w-20" />
            <Sk className="h-6 w-28" />
            <Sk className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-2xl border border-border-default bg-surface-elevated p-4">
        <Sk className="h-4 w-40" />
        <Sk className="h-3.5 w-2/3" />
        <div className="mb-1 text-sm font-medium text-foreground">Database</div>
        <Sk className="h-9 w-72 max-w-full rounded-full" />
      </div>
    </div>
  )
}
