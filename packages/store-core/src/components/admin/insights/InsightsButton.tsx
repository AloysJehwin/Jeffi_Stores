'use client'

import { Box } from 'lucide-react'

export interface InsightsButtonProps {
  onClick: () => void
  /** Whether the drawer it opens is showing. */
  expanded?: boolean
  label?: string
  /** A 32px square icon button (label becomes its name and tooltip). */
  iconOnly?: boolean
  className?: string
}

/** Opens a page's insights drawer; the drawer hands focus back to it on close. */
export function InsightsButton({ onClick, expanded, label = 'Insights', iconOnly = false, className = '' }: InsightsButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={`control-md ${iconOnly ? 'control-icon' : ''} whitespace-nowrap border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${className}`}
    >
      <Box className="h-4 w-4 text-accent-600" aria-hidden="true" />
      {!iconOnly && label}
    </button>
  )
}
