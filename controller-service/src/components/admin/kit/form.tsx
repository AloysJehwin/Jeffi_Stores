'use client'

import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'

// Form layout. Markup only: field names, hidden inputs, server actions and submit buttons stay
// with the caller, so wrapping an existing form in these never changes what it posts.

/** 32px input, the one class every kit input uses. Textareas grow (globals.css unpins them). */
export const fieldInputCls =
  'field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted transition-colors hover:border-border-default focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent disabled:opacity-60'

export interface FormPageProps {
  header?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Called when any field inside changes (input/change events bubble up). Reset on submit. */
  onDirtyChange?: (dirty: boolean) => void
  /** Warn before leaving the page with unsaved edits. Off by default: it is a behaviour change. */
  guardUnload?: boolean
}

/** Create/edit page body: header, the form sections, then the footer. Keep MobileEditBlock outside. */
export function FormPage({ header, children, footer, onDirtyChange, guardUnload }: FormPageProps) {
  const [dirty, setDirty] = useState(false)
  const cb = useRef(onDirtyChange)
  cb.current = onDirtyChange
  useEffect(() => {
    cb.current?.(dirty)
  }, [dirty])
  useEffect(() => {
    if (!guardUnload || !dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [guardUnload, dirty])
  const mark = () => setDirty(true)
  return (
    <div
      className="p-4 sm:p-6 pb-28 lg:pb-6 space-y-5"
      onInput={mark}
      onChange={mark}
      onSubmit={() => setDirty(false)}
    >
      {header}
      {children}
      {footer}
    </div>
  )
}

export interface FormSectionProps {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  aside?: ReactNode
  id?: string
  /** Render as an open-by-default <details>, for long optional sections. */
  collapsible?: boolean
}

/** One card of fields: title, short description, then the fields (two columns from md via FormGrid). */
export function FormSection({ title, description, children, aside, id, collapsible }: FormSectionProps) {
  const head = (
    <div className="min-w-0">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>}
    </div>
  )
  if (collapsible) {
    return (
      <details id={id} open className="group scroll-mt-20 rounded-xl border border-border-default bg-surface-elevated">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-5">
          {head}
          <span className="text-xs text-foreground-muted group-open:hidden">Show</span>
        </summary>
        <div className="space-y-4 px-5 pb-5">{children}</div>
      </details>
    )
  }
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-border-default bg-surface-elevated p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        {head}
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** Two-column field grid from md. */
export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const c = cols === 3 ? 'md:grid-cols-3' : cols === 2 ? 'md:grid-cols-2' : ''
  return <div className={`grid grid-cols-1 gap-4 ${c}`}>{children}</div>
}

export interface FormFieldProps {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  span?: 1 | 2 | 3
  children: ReactNode
}

/** Label above the control, hint below, error in red below the hint. */
export function FormField({ label, htmlFor, hint, error, required, span, children }: FormFieldProps) {
  const spanCls = span === 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : ''
  return (
    <div className={`min-w-0 ${spanCls}`}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-foreground-secondary">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-foreground-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ className = '', type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} {...rest} className={`${fieldInputCls} ${className}`} />
})

export const NumberInput = forwardRef<HTMLInputElement, InputProps>(function NumberInput({ className = '', ...rest }, ref) {
  return <input ref={ref} type="number" inputMode="decimal" {...rest} className={`${fieldInputCls} tabular-nums ${className}`} />
})

/** Rupee amount; the value stays whatever the caller posts (rupees as typed), only the prefix is added. */
export const MoneyInput = forwardRef<HTMLInputElement, InputProps>(function MoneyInput({ className = '', ...rest }, ref) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">Rs</span>
      <input ref={ref} type="number" inputMode="decimal" step="0.01" {...rest} className={`${fieldInputCls} pl-9 tabular-nums ${className}`} />
    </div>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className = '', rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} {...rest} className={`${fieldInputCls} py-2 ${className}`} />
})

export interface FormButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary'
  pending?: boolean
  pendingLabel?: ReactNode
}

/** 32px form button. Defaults to type="submit" so it posts the enclosing form (name/value pass through). */
export function FormButton({ variant = 'primary', pending, pendingLabel, children, className = '', type = 'submit', disabled, ...rest }: FormButtonProps) {
  const v = variant === 'primary' ? 'bg-accent-500 text-white hover:bg-accent-600 font-semibold' : 'border border-border-secondary bg-surface text-foreground hover:bg-surface-secondary font-medium'
  return (
    <button type={type} disabled={disabled || pending} {...rest} className={`control-md whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  )
}

export interface FormFooterProps {
  /** Default submit button label; omit when passing your own buttons as children. */
  submitLabel?: ReactNode
  pending?: boolean
  pendingLabel?: ReactNode
  dirty?: boolean
  onCancel?: () => void
  cancelHref?: string
  cancelLabel?: string
  /** Left side: extra controls (e.g. "Discard draft"). */
  secondary?: ReactNode
  /** Autosave pill — either a status enum (legacy) or a ready-to-render node. The node form lets
   *  callers hide the pill when idle without the footer having to know the status. */
  autosave?: AutosaveStatus | ReactNode
  /** Pre-rendered Draft pending badge; shown left of the banner slot. */
  draftBadge?: ReactNode
  /** One-line notice beside Restore (e.g. "A newer local autosave exists."). */
  banner?: ReactNode
  /** Session-aware actions. Each hides when its handler is not provided. */
  restore?: () => void | Promise<void>
  discard?: () => void | Promise<void>
  /** Session Cancel — when provided, overrides the plain Cancel href/button. Confirms once. */
  cancel?: () => void | Promise<void>
  /** Custom submit buttons (draft/publish intents). Rendered at the right. */
  children?: ReactNode
  /** Sticky to the bottom of the viewport (default). */
  sticky?: boolean
}

const ghostCls =
  'control-md inline-flex items-center border border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const ghostAccentCls =
  'control-md inline-flex items-center border border-accent-500/40 bg-accent-500/10 text-accent-500 hover:bg-accent-500/20 font-semibold transition-colors'

function isAutosaveStatus(v: unknown): v is AutosaveStatus {
  return v === 'idle' || v === 'saving' || v === 'saved' || v === 'error'
}

/** Cancel and submit row. Render it inside the <form> so its buttons submit that form. */
export function FormFooter({
  submitLabel,
  pending,
  pendingLabel,
  dirty,
  onCancel,
  cancelHref,
  cancelLabel = 'Cancel',
  secondary,
  autosave,
  draftBadge,
  banner,
  restore,
  discard,
  cancel,
  children,
  sticky = true,
}: FormFooterProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const autosaveNode = isAutosaveStatus(autosave) ? <AutosaveStatusPill status={autosave} /> : autosave

  const handleCancel = async () => {
    if (!cancel) return
    if (!confirmingCancel) {
      setConfirmingCancel(true)
      setTimeout(() => setConfirmingCancel(false), 4000)
      return
    }
    setConfirmingCancel(false)
    await cancel()
  }

  return (
    <div
      className={`${sticky ? 'sticky bottom-0 z-10 !mt-3' : ''} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface-elevated/95 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur supports-[backdrop-filter]:bg-surface-elevated/80`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-foreground-muted">
        {autosaveNode}
        {draftBadge}
        {banner && <span className="text-foreground-muted">{banner}</span>}
        {restore && (
          <button type="button" onClick={() => void restore()} className={ghostAccentCls}>
            Restore
          </button>
        )}
        {dirty && !autosaveNode && <span>Unsaved changes</span>}
        {secondary}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {discard && (
          <button type="button" onClick={() => void discard()} className={ghostCls}>
            Discard draft
          </button>
        )}
        {cancel ? (
          <button
            type="button"
            onClick={handleCancel}
            className={
              confirmingCancel
                ? 'control-md inline-flex items-center border border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors'
                : ghostCls
            }
          >
            {confirmingCancel ? 'Discard changes?' : cancelLabel}
          </button>
        ) : cancelHref ? (
          <Link href={cancelHref} className={ghostCls}>
            {cancelLabel}
          </Link>
        ) : onCancel ? (
          <button type="button" onClick={onCancel} className={ghostCls}>
            {cancelLabel}
          </button>
        ) : null}
        {children}
        {submitLabel != null && (
          <FormButton pending={pending} pendingLabel={pendingLabel}>
            {submitLabel}
          </FormButton>
        )}
      </div>
    </div>
  )
}
