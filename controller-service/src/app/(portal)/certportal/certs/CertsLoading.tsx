import { Sk } from '@/components/admin/kit/skeleton'

/** The cert cards while the list loads. */
export default function CertsLoading({ count = 2 }: { count?: number }) {
  return (
    <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading certificates">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border-default bg-surface-elevated p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Sk className="h-4 w-36" />
              <Sk className="h-3.5 w-56 max-w-full" />
              <Sk className="h-3 w-40" />
            </div>
            <Sk className="h-5 w-20 rounded-full" />
          </div>
          <Sk className="mt-3 h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}
