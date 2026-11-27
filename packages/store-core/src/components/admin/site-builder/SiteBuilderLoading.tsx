import { Loader2 } from 'lucide-react'
import { Sk } from '@/components/admin/kit/skeleton'

// Loading states for the Site Builder editor: server-safe, shaped like what they stand in for.

/** A spinner with the step in progress; `title` names the job ("Applying Minimalist"). */
export function WorkCard({ title, step }: { title: string; step: string }) {
  return (
    <div role="status" aria-live="polite" className="flex max-w-xs items-center gap-3 rounded-xl border border-border-default bg-surface-elevated px-4 py-3 shadow-lg">
      <Loader2 aria-hidden className="h-5 w-5 shrink-0 animate-spin text-accent-500" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-foreground-muted">{step}</p>
      </div>
    </div>
  )
}

/** Dims and blocks the box it sits in (which must be `relative`); with `work`, the job card shows centred. */
export function BusyOverlay({ work }: { work: { title: string; step: string } | null }) {
  if (!work) return null
  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center rounded-xl bg-[color-mix(in_srgb,var(--color-surface)_70%,transparent)] p-6 pt-24 backdrop-blur-[1px]" aria-busy="true">
      <WorkCard {...work} />
    </div>
  )
}

/** A storefront page's shape: header bar, hero, a row of product tiles. Shown over the preview until it loads. */
export function PreviewSkeleton({ step = 'Loading the preview…', className = '' }: { step?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={step} className={`flex flex-col gap-4 bg-surface p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <Sk className="h-6 w-24" />
        <Sk className="ml-4 h-3.5 w-16" />
        <Sk className="h-3.5 w-16" />
        <Sk className="h-3.5 w-16" />
        <Sk className="ml-auto h-7 w-7 rounded-full" />
      </div>
      <Sk className="h-56 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Sk className="aspect-square w-full rounded-lg" />
            <Sk className="h-3.5 w-3/4" />
            <Sk className="h-3.5 w-1/3" />
          </div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-foreground-muted">
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> {step}
      </p>
    </div>
  )
}

const rowW = ['w-2/3', 'w-1/2', 'w-3/4', 'w-3/5', 'w-1/2', 'w-2/3']

/** The block list while a page's layout loads: switch, name and drag handle per row. */
export function BlockListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading blocks" className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-2.5 py-2.5">
          <Sk className="h-4 w-4 shrink-0" />
          <Sk className={`h-3.5 ${rowW[i % rowW.length]}`} />
          <Sk className="ml-auto h-4 w-4 shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** A side panel's cards (templates, theme fields) while they load. */
export function PanelSkeleton({ cards = 3, label = 'Loading' }: { cards?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-2">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border-default p-3">
          <Sk className="h-4 w-1/2" />
          <Sk className="h-3 w-full" />
          <Sk className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** The draft list view while the editor opens a draft or the visual editor. */
export function EditorSkeleton({ label = 'Opening the editor…' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="rounded-xl border border-border-default bg-surface-elevated p-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <div className="hidden xl:block">
          <BlockListSkeleton />
        </div>
        <PreviewSkeleton step={label} className="rounded-xl border border-border-default" />
        <div className="hidden xl:block">
          <PanelSkeleton />
        </div>
      </div>
    </div>
  )
}
