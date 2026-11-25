'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { CARD_SHADOW } from './viz'

export interface DashCardProps {
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  /** Makes the whole card a button (e.g. opens the activity drawer). */
  onClick?: () => void
  ariaLabel?: string
  className?: string
  children?: ReactNode
}

/** The dashboard card shell: elevated surface, layered shadow, 16px radius. */
export function DashCard({ title, hint, action, onClick, ariaLabel, className = '', children }: DashCardProps) {
  const interactive = !!onClick
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick?.()
    }
  }
  return (
    <section
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={interactive ? onKey : undefined}
      className={`min-w-0 rounded-2xl bg-surface-elevated p-4 sm:p-5 ${CARD_SHADOW} ${interactive ? 'cursor-pointer text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500' : ''} ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {hint && <p className="mt-0.5 text-[11px] text-foreground-muted">{hint}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
