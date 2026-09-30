'use client'

import { useEffect, useRef, useState } from 'react'
import { friendlyCount, SECTION_COPY_DEFAULTS, type ValueStatMetric } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.value_stats

export interface ValueStatItem {
  metric: ValueStatMetric
  label: string
  value: number
}

const DURATION_MS = 1200

interface ValueStatsProps {
  stats: ValueStatItem[]
  eyebrow?: string | null
  title?: string | null
}

export default function ValueStats({ stats, eyebrow, title }: ValueStatsProps) {
  const ref = useRef<HTMLElement>(null)
  // The server renders final figures; the count-up only replays for a band still below the fold.
  const [progress, setProgress] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const rect = el.getBoundingClientRect()
    if (rect.top < window.innerHeight) return
    setProgress(0)
    let frame = 0
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS)
          setProgress(1 - Math.pow(1 - t, 3))
          if (t < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <section ref={ref} className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
            {eyebrow ?? COPY.eyebrow}
          </p>
          <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
        </div>
        <dl
          className={`grid gap-4 grid-cols-2 ${stats.length >= 4 ? 'md:grid-cols-4' : stats.length === 3 ? 'md:grid-cols-3' : ''}`}
        >
          {stats.map(s => (
            <div
              key={s.metric}
              className="flex flex-col-reverse rounded-2xl border border-border-default bg-surface-elevated p-5 md:p-6 text-center"
            >
              <dt className="mt-2 text-xs md:text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
                {s.label}
              </dt>
              <dd className="text-3xl md:text-5xl font-black text-primary-600 dark:text-primary-400 tabular-nums">
                {progress >= 1 ? friendlyCount(s.value) : Math.round(s.value * progress).toLocaleString('en-IN')}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
