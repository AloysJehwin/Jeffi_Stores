'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

interface MobileListCardProps {
  children: ReactNode
  accent?: boolean
  onTap: () => void
  ariaLabel?: string
  className?: string
}

export default function MobileListCard({ children, accent, onTap, ariaLabel, className = '' }: MobileListCardProps) {
  const prefersReduced = useReducedMotion()
  const base = `bg-surface-elevated rounded-lg shadow-sm border p-4 w-full text-left ${accent ? 'border-yellow-400 dark:border-yellow-600' : 'border-border-default'}`

  return (
    <motion.button
      type="button"
      onClick={onTap}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      whileTap={prefersReduced ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={`${base} ${className}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <svg
          className="flex-shrink-0 w-5 h-5 text-foreground-muted mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </motion.button>
  )
}
