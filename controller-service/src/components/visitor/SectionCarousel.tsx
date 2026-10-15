'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface SectionCarouselProps {
  children: React.ReactNode
  /** Width of each item at each breakpoint, e.g. "w-[45%] sm:w-[30%] lg:w-[18%]". */
  itemClassName?: string
  ariaLabel: string
}

// CSS scroll-snap does the scrolling: native momentum, touch and keyboard for free, and the
// content is fully server-rendered. JS only drives the arrow buttons and their disabled state.
export default function SectionCarousel({ children, itemClassName, ariaLabel }: SectionCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const [overflows, setOverflows] = useState(false)

  const sync = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const x = Math.abs(el.scrollLeft)
    setOverflows(max > 1)
    setAtStart(x <= 1)
    setAtEnd(x >= max - 1)
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [sync])

  function scrollBy(direction: -1 | 1) {
    const el = trackRef.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <div className="relative" role="region" aria-label={ariaLabel}>
      <div
        ref={trackRef}
        tabIndex={0}
        className="flex gap-3 md:gap-5 overflow-x-auto snap-x snap-mandatory overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 rounded-lg"
      >
        {Array.isArray(children)
          ? children.map((child, i) => (
              <div key={i} className={`snap-start shrink-0 ${itemClassName ?? 'w-[45%] sm:w-[30%] lg:w-[18%]'}`}>
                {child}
              </div>
            ))
          : children}
      </div>

      {overflows && (
        <>
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            disabled={atStart}
            aria-label={`Scroll ${ariaLabel} left`}
            className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-surface-elevated border border-border-default shadow-sm text-foreground disabled:opacity-0 transition-opacity"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            disabled={atEnd}
            aria-label={`Scroll ${ariaLabel} right`}
            className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-surface-elevated border border-border-default shadow-sm text-foreground disabled:opacity-0 transition-opacity"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  )
}
