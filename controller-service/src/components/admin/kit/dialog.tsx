'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

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

/** Keeps Tab inside the panel and focuses it on open unless a child already took focus (autoFocus). */
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

// `full`: wide two-pane drill-downs (fixed 90dvh, unpadded body that lays out its own panes).
const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-[1400px] h-[90dvh]' }

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  size?: keyof typeof SIZES
  footer?: ReactNode
  children?: ReactNode
  /** Extra key handling on the dialog (Esc already closes). */
  onKeyDown?: (e: React.KeyboardEvent) => void
  /** Hide the X in the header (confirmations close through their buttons). */
  hideClose?: boolean
  zIndex?: string
  /** False keeps it open on backdrop click and Esc (multi-step wizards); the X still closes. */
  dismissible?: boolean
}

// Portals land on <body>, outside the ecom layout's `.ecom-scope`, whose CSS restyles the accent
// classes; carry the scope so a dialog on the ecom host looks like the page that opened it.
const portalScope = () => (document.querySelector('.ecom-scope') ? ' ecom-scope' : '')
const portalStyle = { backgroundColor: 'transparent' } // .ecom-scope paints a surface; the backdrop child does the dimming

/** Centred modal: backdrop click and Esc close it, focus is trapped and page scroll locked. */
export function Dialog({ open, onClose, title, description, size = 'md', footer, children, onKeyDown, hideClose, zIndex = 'z-[1000]', dismissible = true }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useScrollLock(open)
  useFocusTrap(open, panel)
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4${portalScope()}`}
      style={portalStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          if (dismissible) onClose()
          return
        }
        onKeyDown?.(e)
      }}
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panel}
        tabIndex={-1}
        className={`relative flex max-h-[90vh] w-full ${SIZES[size]} ${size === 'full' ? 'max-h-[90dvh]' : ''} flex-col rounded-xl border border-border-default bg-surface-elevated shadow-2xl outline-none animate-fade-in-up`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-foreground">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>}
          </div>
          {!hideClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="control-sm control-icon -mr-1 -mt-1 text-foreground-muted hover:bg-surface-secondary hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {children != null && <div className={size === 'full' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto p-5'}>{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border-default px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  /** Present for usePrompt: a single text input. */
  input?: { value: string; placeholder?: string; onChange: (v: string) => void }
  onClose: (confirmed: boolean) => void
}

/** The renderer behind useConfirm/usePrompt (contexts/ConfirmContext): Enter confirms, Esc cancels. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, variant = 'default', input, onClose }: ConfirmDialogProps) {
  const danger = variant === 'danger'
  return (
    <Dialog
      open={open}
      onClose={() => onClose(false)}
      hideClose
      title={title || (danger ? 'Are you sure?' : 'Confirm')}
      onKeyDown={e => {
        if (e.key === 'Enter') onClose(true)
      }}
      footer={
        <>
          <button type="button" onClick={() => onClose(false)} autoFocus={!input} className="control-md font-medium text-foreground-secondary hover:text-foreground">
            {cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className={`control-md font-semibold text-white active:scale-95 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent-500 hover:bg-accent-600'}`}
          >
            {confirmLabel || (danger ? 'Delete' : input ? 'OK' : 'Confirm')}
          </button>
        </>
      }
    >
      <p className="whitespace-pre-line text-sm text-foreground-secondary">{message}</p>
      {input && (
        <input
          autoFocus
          value={input.value}
          placeholder={input.placeholder}
          onChange={e => input.onChange(e.target.value)}
          className="field-md mt-3 w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      )}
    </Dialog>
  )
}

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

/** Mobile bottom sheet (full width, slides up); a centred panel from sm up. */
export function Sheet({ open, onClose, title, description, footer, children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useScrollLock(open)
  useFocusTrap(open, panel)
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className={`fixed inset-0 z-[1000] flex items-end justify-center sm:items-center sm:p-4${portalScope()}`}
      style={portalStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={e => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-border-default bg-surface-elevated shadow-2xl outline-none animate-fade-in-up sm:max-w-md sm:rounded-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-default sm:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-foreground">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="control-sm control-icon -mr-1 text-foreground-muted hover:bg-surface-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children != null && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border-default px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
