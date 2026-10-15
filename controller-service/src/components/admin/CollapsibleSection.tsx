'use client'

import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  count?: number
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}

export default function CollapsibleSection({ title, count, defaultOpen = false, children, className }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className ?? 'bg-surface-elevated rounded-xl border border-border-default p-5'}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 group"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">{title}</span>
          {typeof count === 'number' && count > 0 && (
            <span className="text-xs font-semibold bg-surface-secondary text-foreground-secondary px-1.5 py-0.5 rounded-full tabular-nums">
              {count}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-foreground-muted transition-transform group-hover:text-foreground ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  )
}
