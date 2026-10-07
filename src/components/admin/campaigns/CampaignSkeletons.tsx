// Shimmer placeholders shaped like the campaign pages, shared by route loading.tsx and the clients.

import type { ReactNode } from 'react'

const bar = 'bg-surface-secondary rounded'
const card = 'bg-surface-elevated rounded-xl border border-border-default animate-pulse'

function Rows({ n, h = 'h-10' }: { n: number; h?: string }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`${h} border-t border-border-default flex items-center gap-3 px-4`}>
          <div className={`h-3 flex-1 ${bar}`} />
          <div className={`h-3 w-20 ${bar} hidden sm:block`} />
          <div className={`h-3 w-14 ${bar}`} />
        </div>
      ))}
    </>
  )
}

export function CampaignDetailSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in" aria-busy="true" aria-label="Loading campaign">
      <div className={`${card} p-5 space-y-3`}>
        <div className={`h-3 w-48 ${bar}`} />
        <div className="flex gap-2">
          <div className={`h-9 flex-1 ${bar}`} />
          <div className={`h-9 w-24 ${bar}`} />
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className={`${card} p-5 space-y-4`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className={`h-6 w-48 ${bar}`} />
              <div className={`h-4 w-64 ${bar} opacity-70`} />
            </div>
            <div className={`h-5 w-20 ${bar}`} />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ animationDelay: `${i * 60}ms` }}>
              <div className={`h-3 w-28 ${bar} mb-2`} />
              <div className={`h-9 ${bar}`} />
            </div>
          ))}
          <div className={`h-32 ${bar}`} />
        </div>
        <div className={`${card} p-5 space-y-3`}>
          <div className={`h-3 w-24 ${bar}`} />
          <div className={`h-5 w-3/4 ${bar}`} />
          <div className={`h-72 ${bar}`} />
        </div>
      </div>
      <div className={`${card} overflow-hidden`}>
        <div className="p-4 flex items-center justify-between">
          <div className={`h-4 w-40 ${bar}`} />
          <div className={`h-8 w-20 ${bar}`} />
        </div>
        <Rows n={4} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className={`${card} overflow-hidden`}>
            <div className="p-4">
              <div className={`h-4 w-32 ${bar}`} />
            </div>
            <Rows n={3} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CampaignCardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${card} p-5`} style={{ animationDelay: `${i * 50}ms` }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className={`h-5 w-40 ${bar}`} />
              <div className={`h-3 w-56 ${bar}`} />
              <div className={`h-3 w-32 ${bar}`} />
            </div>
            <div className={`h-8 w-20 ${bar}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ScenarioDetailSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in" aria-busy="true" aria-label="Loading scenario">
      <div className={`h-4 w-48 ${bar} animate-pulse`} />
      <div className={`${card} p-5 space-y-3`}>
        <div className={`h-7 w-56 ${bar}`} />
        <div className={`h-4 w-3/4 ${bar} opacity-70`} />
        <div className={`h-24 ${bar}`} />
      </div>
      <div className={`${card} overflow-hidden`}>
        <div className="p-4">
          <div className={`h-4 w-40 ${bar}`} />
        </div>
        <Rows n={3} h="h-14" />
      </div>
    </div>
  )
}

// Route-level shell: breadcrumb/title placeholder + page body, padded like the real pages.
export function CampaignPageSkeleton({ children, title = false }: { children: ReactNode; title?: boolean }) {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      {title ? (
        <div className="space-y-2 animate-pulse">
          <div className={`h-8 w-48 ${bar}`} />
          <div className={`h-4 w-72 ${bar} opacity-60`} />
        </div>
      ) : (
        <div className={`h-4 w-40 ${bar} animate-pulse`} />
      )}
      {children}
    </div>
  )
}
