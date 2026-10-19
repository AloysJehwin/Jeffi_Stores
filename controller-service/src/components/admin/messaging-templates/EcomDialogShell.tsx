'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Ecom-themed modal shell. Mirrors PlayDialog's chrome (cream panel, terracotta accents,
// soft shadow, pill controls) and wraps the portal content in `.ecom-scope` so the ecom
// CSS tokens (ecom.css) resolve regardless of mount context — the ScenarioFillDialog
// renders in both admin and ecom pages but should always read as the ecom portal.

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

let locks = 0
function useScrollLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof document === 'undefined') return
    const prev = document.body.style.overflow
    locks++
    document.body.style.overflow = 'hidden'
    return () => {
      locks--
      if (locks === 0) document.body.style.overflow = prev
    }
  }, [on])
}

function useFocusTrap(open: boolean, panel: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return
    const el = panel.current
    if (!el) return
    const back = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      el.removeEventListener('keydown', onKey)
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
    }
  }, [open, panel])
}

export interface EcomDialogShellProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

/** Centred modal with the ecom portal look. Backdrop click + Esc close; focus is trapped. */
export default function EcomDialogShell({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: EcomDialogShellProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useScrollLock(open)
  useFocusTrap(open, panel)
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="ecom-scope fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="fixed inset-0 bg-foreground/30 animate-fade-in" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border-default bg-surface-elevated shadow-2xl outline-none animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-6 pb-4 pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-semibold text-foreground">
              {title}
            </h2>
            {description && <p className="mt-1 text-xs text-foreground-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="org-square -mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-muted hover:bg-surface-secondary hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#c46a46]/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children != null && <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border-default px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
