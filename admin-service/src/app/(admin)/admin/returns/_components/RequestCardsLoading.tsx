import { LoadingLines, Sk } from '@/components/admin/kit/skeleton'

/** Return / replacement request cards while the list's first page loads. */
export default function RequestCardsLoading({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface border border-border-default rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-default bg-surface-secondary">
            <div className="flex items-center gap-2">
              <Sk className="h-4 w-20" />
              <Sk className="h-5 w-16 rounded-full" />
            </div>
            <Sk className="h-3 w-16" />
          </div>
          <div className="p-4">
            <LoadingLines lines={3} />
          </div>
        </div>
      ))}
    </div>
  )
}
