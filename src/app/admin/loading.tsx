import AdminSkeleton from '@/components/admin/AdminSkeleton'

export default function AdminLoading() {
  return (
    <div className="h-screen flex flex-row bg-surface-secondary">
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
          <AdminSkeleton variant="list" />
        </main>
      </div>
    </div>
  )
}
