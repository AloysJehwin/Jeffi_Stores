'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
  title?: string
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[]
  /** The active option; null leaves none filled (e.g. a custom period). */
  value: T | null
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
}

/** The overview segmented control: a bordered group of text buttons, the active one filled with the brand accent. Arrow keys move focus. */
export function SegmentedControl<T extends string = string>({ options, value, onChange, ariaLabel, className = '' }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = options.length
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (next < 0) return
    e.preventDefault()
    refs.current[next]?.focus()
  }
  return (
    <div role="group" aria-label={ariaLabel} className={`flex h-control max-w-full overflow-x-auto gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={el => {
              refs.current[i] = el
            }}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={e => onKey(e, i)}
            className={`flex items-center px-2.5 text-xs font-medium rounded-md whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 ${on ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
