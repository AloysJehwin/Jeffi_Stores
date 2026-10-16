'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { portalRoot } from '@/lib/shared/portal-root'
import { adTextLength } from '@/lib/google-ads/limits'

// Small form pieces shared by the campaign wizard and the add-assets dialog.

export const inputCls =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500/40'
export const btnPrimary =
  'inline-flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50'
export const btnGhost =
  'inline-flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-sm text-foreground hover:bg-surface-secondary disabled:opacity-50'

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-xs font-medium text-foreground-secondary">{label}</span>
      {children}
      {hint && <span className="block text-xs text-foreground-muted">{hint}</span>}
    </label>
  )
}

export function CharCount({ value, max }: { value: string; max: number }) {
  const n = adTextLength(value)
  return (
    <span className={`text-[11px] tabular-nums ${n > max ? 'text-red-500 font-medium' : 'text-foreground-muted'}`} aria-label={`${n} of ${max} characters`}>
      {n}/{max}
    </span>
  )
}

/** One text input with a live character counter against Google's limit. */
export function LimitedInput({
  value,
  onChange,
  max,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  max: number
  placeholder?: string
  ariaLabel?: string
}) {
  const over = adTextLength(value) > max
  return (
    <div className="flex items-center gap-2">
      <input
        className={`${inputCls} ${over ? 'border-red-500 focus:ring-red-500/40' : ''}`}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={over}
        onChange={e => onChange(e.target.value)}
      />
      <CharCount value={value} max={max} />
    </div>
  )
}

/** A list of ad texts (headlines, descriptions, callouts) with counters, add/remove and an AI slot. */
export function TextList({
  label,
  items,
  onChange,
  max,
  min = 0,
  maxItems,
  placeholder,
  action,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  max: number
  min?: number
  maxItems: number
  placeholder?: string
  action?: ReactNode
}) {
  const filledCount = items.filter(s => s.trim()).length
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground-secondary">
          {label}{' '}
          <span className={filledCount < min ? 'text-red-500' : 'text-foreground-muted'}>
            ({filledCount}/{maxItems}, at least {min}, up to {max} characters each)
          </span>
        </span>
        {action}
      </div>
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1">
            <LimitedInput value={v} max={max} placeholder={placeholder} ariaLabel={`${label} ${i + 1}`} onChange={nv => onChange(items.map((x, j) => (j === i ? nv : x)))} />
          </div>
          <button type="button" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} className="p-1.5 text-foreground-muted hover:text-red-500">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      {items.length < maxItems && (
        <button type="button" className="text-xs text-accent-600 inline-flex items-center gap-1" onClick={() => onChange([...items, ''])}>
          <Plus className="w-3.5 h-3.5" /> Add {label.toLowerCase()}
        </button>
      )}
    </div>
  )
}

export function AiButton({ busy, onClick, label = 'Write with AI' }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className="inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700 disabled:opacity-50">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
      {label}
    </button>
  )
}

export function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-secondary px-2.5 py-1 text-xs">
      {label}
      {onRemove && (
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="text-foreground-muted hover:text-red-500">
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} rounded-xl border border-border-default bg-surface-elevated shadow-xl`}>
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-foreground-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-default px-5 py-3">{footer}</div>}
      </div>
    </div>,
    portalRoot()
  )
}

export const num = (s: string): number | null => {
  const n = Number(String(s).replace(/,/g, '').trim())
  return s.trim() === '' || !Number.isFinite(n) ? null : n
}
