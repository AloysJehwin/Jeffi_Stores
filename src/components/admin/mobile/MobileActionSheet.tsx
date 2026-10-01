'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export interface MobileAction {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

interface MobileActionSheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  actions: MobileAction[]
}

export default function MobileActionSheet({ open, onClose, title, actions }: MobileActionSheetProps) {
  const prefersReduced = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[320] flex flex-col justify-end" role="dialog" aria-modal="true">
          <motion.div
            className="absolute inset-0 bg-black/50"
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className="relative m-2 mb-3"
            initial={prefersReduced ? false : { y: '110%' }}
            animate={{ y: 0 }}
            exit={prefersReduced ? { opacity: 0 } : { y: '110%' }}
            transition={prefersReduced ? { duration: 0.15 } : { duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="rounded-2xl bg-surface-elevated border border-border-default shadow-2xl overflow-hidden">
              {title && (
                <div className="px-4 py-2.5 text-center text-xs font-medium text-foreground-muted border-b border-border-default">
                  {title}
                </div>
              )}
              <div className="divide-y divide-border-default">
                {actions.map(action => (
                  <button
                    key={action.key}
                    type="button"
                    disabled={action.disabled}
                    onClick={() => {
                      action.onSelect()
                      onClose()
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors disabled:opacity-40 ${
                      action.danger
                        ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                        : 'text-foreground hover:bg-surface-secondary'
                    }`}
                  >
                    {action.icon && <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">{action.icon}</span>}
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full rounded-2xl bg-surface-elevated border border-border-default shadow-lg px-4 py-3.5 text-sm font-semibold text-foreground hover:bg-surface-secondary transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
