'use client'

import { useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Play, Pause } from 'lucide-react'
import { BrowserFrame } from '@/app/(ecom)/ecom/BrowserFrame'
import { DemoProvider, useDemo } from './store'
import StorefrontSurface from './StorefrontSurface'
import AdminSurface from './AdminSurface'

function SurfaceFade({ surfaceKey, reduced, children }: { surfaceKey: string; reduced: boolean; children: ReactNode }) {
  if (reduced) {
    return (
      <div key={surfaceKey} className="h-full">
        {children}
      </div>
    )
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={surfaceKey}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

function FlowTabs() {
  const { flow, flows, isPlaying, actions } = useDemo()
  return (
    <div className="flex items-center gap-3 h-14">
      <div className="flex gap-2 overflow-x-auto min-w-0 flex-1 pb-1">
        {flows.map(f => {
          const active = f.id === flow
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => actions.setFlow(f.id)}
              aria-current={active ? 'true' : undefined}
              className={clsx(
                'shrink-0 whitespace-nowrap rounded-full px-4 py-2 min-h-11 sm:min-h-0 text-sm font-semibold transition-colors',
                active ? 'ecom-accent-bg text-white' : 'org-sand org-sand-hover text-foreground'
              )}
            >
              {f.title}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={isPlaying ? actions.pause : actions.play}
        aria-label={isPlaying ? 'Pause demo' : 'Play demo'}
        className="shrink-0 flex items-center justify-center w-11 h-11 sm:w-10 sm:h-10 rounded-full org-sand org-sand-hover ecom-accent-text"
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
    </div>
  )
}

// Dots on a hairline; always 4 slots so 3-chapter flows don't change the row width or height.
function Stepper() {
  const { chapter, chapters, flow, actions } = useDemo()
  const steps = chapters.filter(c => c.flow === flow)
  const activePos = steps.findIndex(c => c.id === chapter.id)
  const slots = Array.from({ length: 4 }, (_, i) => steps[i] ?? null)
  return (
    <div className="grid grid-cols-4 h-[4.5rem] sm:h-16 items-start">
      {slots.map((c, i) => {
        if (!c) return <div key={`empty-${i}`} />
        const globalIndex = chapters.findIndex(x => x.id === c.id)
        const active = i === activePos
        const done = i < activePos
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => actions.goToChapter(globalIndex)}
            className="group text-left min-w-0 min-h-11 sm:min-h-0"
          >
            <div className="relative h-4 flex items-center">
              <span className="absolute inset-x-0 h-px bg-border-secondary" />
              <span
                className={clsx(
                  'relative w-4 h-4 rounded-full border-2 transition-colors',
                  active || done ? 'ecom-accent-bg ecom-accent-border' : 'bg-surface border-border-secondary group-hover:border-foreground-muted'
                )}
              />
            </div>
            <div
              className={clsx(
                'mt-2 text-xs break-words pr-1 sm:text-sm sm:truncate sm:pr-3',
                active ? 'font-bold text-foreground' : 'text-foreground-muted'
              )}
            >
              {c.title}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function StageInner() {
  const { chapter, reducedMotion, actions } = useDemo()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number }>).detail
      if (detail && typeof detail.index === 'number') actions.goToChapter(detail.index)
    }
    window.addEventListener('ecom-demo-goto', handler as EventListener)
    return () => window.removeEventListener('ecom-demo-goto', handler as EventListener)
  }, [actions])

  const isStorefront = chapter.surface === 'storefront'
  const caption = isStorefront ? 'novastore.jeffistores.in' : `admin - ${chapter.title}`

  return (
    <div className="w-full flex flex-col">
      <FlowTabs />

      <BrowserFrame alt={chapter.title} caption={caption} className="w-full relative mt-2">
        <div className="h-[560px] lg:h-[620px] overflow-hidden">
          <SurfaceFade surfaceKey={chapter.surface} reduced={reducedMotion}>
            {isStorefront ? <StorefrontSurface /> : <AdminSurface />}
          </SurfaceFade>
        </div>
      </BrowserFrame>

      <div className="mt-6">
        <Stepper />
      </div>
      <p className="mt-1 min-h-[2.5rem] text-sm text-foreground-secondary break-words sm:mt-0 sm:h-6 sm:min-h-0 sm:text-base sm:truncate">
        <span className="font-semibold text-foreground">{chapter.title}</span> — {chapter.blurb}
      </p>
    </div>
  )
}

export default function DemoStage({ initialChapter }: { initialChapter?: number }) {
  return (
    <DemoProvider initialChapter={initialChapter}>
      <StageInner />
    </DemoProvider>
  )
}
