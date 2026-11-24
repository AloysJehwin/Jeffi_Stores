'use client'

import { useRef, type KeyboardEvent } from 'react'

export interface PillOption<T extends string = string> {
  value: T
  label: string
}

export interface SegmentedPillsProps<T extends string = string> {
  options: PillOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}

/** Neutral pill segmented control: the selected segment is a white pill with a shadow. Arrow keys move and select. */
export function SegmentedPills<T extends string = string>({ options, value, onChange, ariaLabel, size = 'md', className = '' }: SegmentedPillsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = options.length
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`inline-flex items-center gap-0.5 rounded-full bg-surface-secondary p-0.5 ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={el => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={e => onKey(e, i)}
            className={`rounded-full font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${pad} ${
              on ? 'bg-surface-elevated text-foreground shadow-[0_1px_2px_rgba(0,0,0,.12),0_0_0_1px_rgba(0,0,0,.04)] dark:shadow-[0_0_0_1px_rgba(255,255,255,.12)]' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
