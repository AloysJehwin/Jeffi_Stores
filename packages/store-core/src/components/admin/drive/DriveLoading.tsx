import type { ReactNode } from 'react'
import { HardDrive, Images, Trash2 } from 'lucide-react'
import { LoadingTable, Sk } from '@/components/admin/kit/skeleton'

// Server-safe placeholders shaped like the Drive (DriveBrowser / DriveGrid).

/** Folder tiles and file cards (or list rows) while a folder loads. */
export function DriveItemsLoading({ view = 'grid' }: { view?: 'grid' | 'list' }) {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label="Loading files">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Folders</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5">
              <Sk className="h-8 w-8 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Sk className="h-3.5 w-3/4" />
                <Sk className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Files</h3>
        {view === 'list' ? (
          <LoadingTable columns={['Name', 'Uploaded by', 'Size', 'Added']} rows={8} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border-2 border-border-default bg-surface-elevated">
                <Sk className="aspect-square w-full rounded-none" />
                <div className="space-y-1.5 px-2 py-1.5">
                  <Sk className="h-3 w-3/4" />
                  <Sk className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Place({ icon, active, children }: { icon: ReactNode; active?: boolean; children: ReactNode }) {
  return (
    <span className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${active ? 'bg-primary-500/10 font-semibold text-primary-600 dark:text-primary-400' : 'text-foreground-secondary'}`}>
      {icon}
      {children}
    </span>
  )
}

/** The whole Drive (places, toolbar and My Drive) for the page's loading screen. */
export default function DriveBrowserLoading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="Drive" className="flex gap-1 overflow-x-auto lg:flex-col">
        <Place icon={<HardDrive className="h-4 w-4" />} active>
          My Drive
        </Place>
        <Place icon={<Images className="h-4 w-4" />}>Gallery</Place>
        <Place icon={<Trash2 className="h-4 w-4" />}>Trash</Place>
        <p className="hidden px-3 pt-3 text-[11px] leading-relaxed text-foreground-muted lg:block">
          Files here are private to staff. Links are signed and expire after a few minutes. Gallery items are public.
        </p>
      </nav>
      <section className="min-w-0 rounded-xl border border-border-default bg-surface-elevated">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-4 py-3">
          <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">My Drive</span>
          <Sk className="h-control w-28 rounded-lg" />
          <Sk className="h-control w-24 rounded-lg" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-4 py-2.5">
          <Sk className="h-control min-w-[12rem] flex-1 rounded-lg" />
          <Sk className="h-control w-36 rounded-lg" />
          <Sk className="h-8 w-16 rounded-lg" />
        </div>
        <div className="min-h-[50vh] p-4">
          <DriveItemsLoading />
        </div>
      </section>
    </div>
  )
}
