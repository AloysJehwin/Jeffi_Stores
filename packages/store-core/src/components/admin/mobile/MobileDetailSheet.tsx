'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

interface MobileDetailSheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

export default function MobileDetailSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: MobileDetailSheetProps) {
  const prefersReduced = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[300] flex flex-col justify-end" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 bg-black/50"
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="relative bg-surface-elevated rounded-t-2xl shadow-2xl border-t border-border-default max-h-[92vh] flex flex-col"
            initial={prefersReduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { y: '100%' }}
            transition={prefersReduced ? { duration: 0.15 } : { duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="flex-shrink-0 px-5 pt-3 pb-3 border-b border-border-default">
              <div className="w-10 h-1 bg-border-default rounded-full mx-auto mb-3" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-foreground leading-tight truncate">{title}</h2>
                  {subtitle && <div className="text-xs text-foreground-muted mt-0.5">{subtitle}</div>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex-shrink-0 p-1.5 rounded-lg hover:bg-surface-secondary text-foreground-muted hover:text-foreground transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && (
              <div className="flex-shrink-0 px-5 py-3 border-t border-border-default bg-surface-elevated">{footer}</div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
