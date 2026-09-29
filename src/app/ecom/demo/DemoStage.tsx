'use client'

import { useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Play, Pause, Check } from 'lucide-react'
import { BrowserFrame } from '../BrowserFrame'
import { DemoProvider, useDemo } from './store'
import StorefrontSurface from './StorefrontSurface'
import AdminSurface from './AdminSurface'

function SurfaceFade({
  surfaceKey,
  reduced,
  children,
}: {
  surfaceKey: string
  reduced: boolean
  children: ReactNode
}) {
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
  const { flow, flows, actions } = useDemo()
  return (
    <div className="border-b border-border-default overflow-x-auto">
      <div className="flex gap-6 min-w-max">
        {flows.map((f) => {
          const active = f.id === flow
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => actions.setFlow(f.id)}
              aria-current={active ? 'true' : undefined}
              className={clsx(
                'relative whitespace-nowrap pb-3 pt-1 text-sm font-semibold transition-colors',
                active ? 'text-foreground' : 'text-foreground-muted hover:text-foreground-secondary'
              )}
            >
              {f.title}
              {active && (
                <motion.span
                  layoutId="ecom-flow-underline"
                  className="ecom-accent-bg absolute left-0 right-0 -bottom-px h-0.5 rounded-full"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Stepper() {
  const { chapter, chapters, flow, actions, reducedMotion } = useDemo()
  const steps = chapters.filter((c) => c.flow === flow)
  const activePos = steps.findIndex((c) => c.id === chapter.id)
  return (
    <div className="flex items-center overflow-x-auto py-1">
      {steps.map((c, i) => {
        const globalIndex = chapters.findIndex((x) => x.id === c.id)
        const done = i < activePos
        const active = i === activePos
        return (
          <div key={c.id} className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => actions.goToChapter(globalIndex)}
              aria-current={active ? 'step' : undefined}
              className="group flex items-center gap-2"
            >
              <span
                className={clsx(
                  'flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold border transition',
                  active && 'ecom-accent-bg ecom-accent-border text-white',
                  done && 'ecom-accent-bg ecom-accent-border text-white',
                  !active && !done && 'border-border-default bg-surface-elevated text-foreground-muted group-hover:border-border-secondary'
                )}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className={clsx('whitespace-nowrap text-xs font-medium transition-colors', active ? 'text-foreground' : 'text-foreground-muted group-hover:text-foreground-secondary')}>
                {c.title}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className="mx-2 h-px w-8 bg-border-default relative overflow-hidden">
                <motion.span
                  className="ecom-accent-bg absolute inset-y-0 left-0"
                  initial={false}
                  animate={{ width: done ? '100%' : '0%' }}
                  transition={reducedMotion ? { duration: 0 } : { duration: 0.4 }}
                />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StageInner() {
  const { chapter, flow, flows, isPlaying, reducedMotion, actions } = useDemo()

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
  const activeFlow = flows.find((f) => f.id === flow)

  return (
    <div className="ecom-clean w-full flex flex-col">
      <FlowTabs />
      {activeFlow && (
        <p className="text-sm text-foreground-secondary mt-3">{activeFlow.blurb}</p>
      )}
      <div className="mt-3 mb-4">
        <Stepper />
      </div>

      <BrowserFrame alt={chapter.title} caption={caption} className="w-full relative">
        <button
          type="button"
          onClick={isPlaying ? actions.pause : actions.play}
          aria-label={isPlaying ? 'Pause demo' : 'Play demo'}
          className="ecom-accent-bg absolute top-2 right-3 z-10 flex items-center justify-center w-8 h-8 rounded-full text-white shadow-md hover:opacity-90 transition"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="bg-surface h-[68svh] min-h-[420px] sm:h-[calc(82svh-2.25rem)] sm:min-h-[484px] max-h-[864px] overflow-hidden">
          <SurfaceFade surfaceKey={chapter.surface} reduced={reducedMotion}>
            {isStorefront ? <StorefrontSurface /> : <AdminSurface />}
          </SurfaceFade>
        </div>
      </BrowserFrame>
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
