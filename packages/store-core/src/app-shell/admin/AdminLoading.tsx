import { LoadingLines, LoadingToolbar, PageLoading, Sk } from '@/components/admin/kit/skeleton'

// Fallback for routes without their own loading.tsx: a generic list-shaped shimmer.
export default function AdminLoading() {
  return (
    <div className="fixed inset-0 flex flex-row bg-surface-secondary z-50">
      {/* Sidebar placeholder — matches collapsed sidebar width */}
      <div className="hidden md:flex flex-col w-14 shrink-0 bg-secondary-600 dark:bg-secondary-800 border-r border-white/10" />

      {/* Right column */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Topbar placeholder */}
        <div className="h-12 bg-secondary-500 dark:bg-secondary-700 shrink-0 flex items-center px-4 gap-3">
          <div className="ml-auto flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-white/20" />
            <div className="hidden sm:block space-y-1">
              <div className="h-2.5 w-20 rounded bg-white/20" />
              <div className="h-2 w-12 rounded bg-white/10" />
            </div>
          </div>
        </div>

        {/* Content area */}
        <main className="flex-1 bg-surface-secondary overflow-y-auto">
          <PageLoading actions={1}>
            <LoadingToolbar filters={2} />
            <div className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
              <div className="border-b border-border-default bg-surface-secondary/50 px-3 py-3">
                <Sk className="h-3 w-1/3" />
              </div>
              <div className="p-4">
                <LoadingLines lines={8} />
              </div>
            </div>
          </PageLoading>
        </main>
      </div>
    </div>
  )
}
