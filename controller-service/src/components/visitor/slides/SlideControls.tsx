'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion, useTransform, type MotionValue } from 'motion/react'

export type ArrowsVariant = 'overlay' | 'rail'

const ARROW: Record<ArrowsVariant, { base: string; prev: string; next: string; icon: string }> = {
  // Glass chevrons over imagery, md and up.
  overlay: {
    base: 'absolute top-1/2 z-30 hidden -translate-y-1/2 rounded-full border border-white/25 bg-black/30 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/50 disabled:pointer-events-none disabled:opacity-0 md:inline-flex',
    prev: 'left-4',
    next: 'right-4',
    icon: 'h-5 w-5',
  },
  // Half outside a row of cards on the page surface, sm and up.
  rail: {
    base: 'hidden sm:flex absolute top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-surface-elevated border border-border-default shadow-sm text-foreground disabled:opacity-0 transition-opacity',
    prev: 'left-0 -translate-x-1/2',
    next: 'right-0 translate-x-1/2',
    icon: 'w-4 h-4',
  },
}

export interface SlideArrowsProps {
  onPrev: () => void
  onNext: () => void
  prevDisabled?: boolean
  nextDisabled?: boolean
  prevLabel?: string
  nextLabel?: string
  variant?: ArrowsVariant
  className?: string
}

export function SlideArrows({
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  prevLabel = 'Previous slide',
  nextLabel = 'Next slide',
  variant = 'overlay',
  className = '',
}: SlideArrowsProps) {
  const a = ARROW[variant]
  return (
    <>
      <button
        type="button"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label={prevLabel}
        className={`${a.base} ${a.prev} ${className}`}
      >
        <ChevronLeft className={a.icon} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label={nextLabel}
        className={`${a.base} ${a.next} ${className}`}
      >
        <ChevronRight className={a.icon} aria-hidden="true" />
      </button>
    </>
  )
}

export type DotsTone = 'light' | 'brand'
export type DotsSize = 'md' | 'sm'

const DOT: Record<DotsTone, Record<DotsSize, [active: string, idle: string]>> = {
  light: {
    md: ['bg-white w-5 h-2', 'bg-white/35 hover:bg-white/60 w-2 h-2'],
    sm: ['bg-white w-3 h-1', 'bg-white/40 w-1 h-1'],
  },
  brand: {
    md: ['bg-primary-500 w-5 h-2', 'bg-foreground/20 hover:bg-foreground/40 w-2 h-2'],
    sm: ['bg-primary-500 w-3 h-1', 'bg-foreground/20 w-1 h-1'],
  },
}

export interface SlideDotsProps {
  count: number
  index: number
  onSelect: (index: number) => void
  tone?: DotsTone
  size?: DotsSize
  label?: (index: number) => string
  /** Placement, e.g. "absolute bottom-5 left-1/2 -translate-x-1/2 z-30". */
  className?: string
}

// The active dot stretches into a pill. preventDefault keeps a dot inside a link from following it.
export function SlideDots({
  count,
  index,
  onSelect,
  tone = 'light',
  size = 'md',
  label = i => `Go to slide ${i + 1}`,
  className = '',
}: SlideDotsProps) {
  const [on, off] = DOT[tone][size]
  return (
    <div className={`flex items-center ${size === 'sm' ? 'gap-1' : 'gap-2'} ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={e => {
            e.preventDefault()
            onSelect(i)
          }}
          aria-label={label(i)}
          aria-current={i === index ? 'true' : undefined}
          className={`rounded-full transition-all duration-300 motion-reduce:transition-none ${i === index ? on : off}`}
        />
      ))}
    </div>
  )
}

export interface SegmentProps {
  index: number
  active: number
  progress: MotionValue<number>
  onSelect?: () => void
  label?: string
}

// Past segments full, the current one filling with the clock, later ones empty.
export function Segment({ index, active, progress, onSelect, label }: SegmentProps) {
  const fill = useTransform(progress, v => (index < active ? 1 : index === active ? v : 0))
  const bar = (
    <span
      className={`block h-0.5 overflow-hidden rounded-full bg-white/30 ${onSelect ? 'w-full transition-colors group-hover:bg-white/50' : 'flex-1'}`}
    >
      <motion.span className="block h-full w-full origin-left bg-white" style={{ scaleX: fill }} />
    </span>
  )
  if (!onSelect) return bar
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-current={index === active ? 'true' : undefined}
      className="group flex h-6 max-w-[6rem] flex-1 items-center"
    >
      {bar}
    </button>
  )
}

export interface SlideProgressProps {
  count: number
  index: number
  progress: MotionValue<number>
  /** Makes each segment a button; without it the bar is decorative. */
  onSelect?: (index: number) => void
  label?: (index: number) => string
  className?: string
}

export function SlideProgress({ count, index, progress, onSelect, label, className = 'flex gap-1.5' }: SlideProgressProps) {
  return (
    <div className={className} aria-hidden={onSelect ? undefined : true}>
      {Array.from({ length: count }, (_, i) => (
        <Segment
          key={i}
          index={i}
          active={index}
          progress={progress}
          onSelect={onSelect ? () => onSelect(i) : undefined}
          label={label?.(i)}
        />
      ))}
    </div>
  )
}
