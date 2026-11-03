'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type ConfirmSpec = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; variant?: 'default' | 'danger' }

/** A page or header action. `href` must already be resolved (ap(path, host)). `scope` only
 * disables the button for read-only admins; the server gate stays where it is. */
export interface KitAction {
  key?: string
  label: string
  icon?: LucideIcon
  href?: string
  onClick?: () => void | Promise<void>
  danger?: boolean
  confirm?: string | ConfirmSpec
  scope?: string
  disabled?: boolean
  busy?: boolean
}

const VARIANT = {
  primary: 'bg-accent-500 text-white hover:bg-accent-600 font-medium',
  secondary: 'border border-border-default bg-surface-elevated text-foreground hover:bg-surface-secondary',
  danger: 'border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10',
}

/** One action as a 32px button or link; disabled (not hidden) without write scope. */
export function ActionButton({ action, variant = 'secondary' }: { action: KitAction; variant?: 'primary' | 'secondary' }) {
  const confirm = useConfirm()
  const allowed = useCanWrite(action.scope ?? 'none')
  const [running, setRunning] = useState(false)
  const disabled = action.disabled || action.busy || running || (!!action.scope && !allowed)
  const cls = `control-md whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none ${action.danger ? VARIANT.danger : VARIANT[variant]}`
  const Icon = action.busy || running ? Loader2 : action.icon
  const inner = (
    <>
      {Icon && <Icon className={`w-4 h-4 ${action.busy || running ? 'animate-spin' : ''}`} />}
      {action.label}
    </>
  )
  if (action.href !== undefined && !disabled) {
    return (
      <Link href={action.href} className={cls}>
        {inner}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      title={action.scope && !allowed ? 'You do not have write access' : undefined}
      className={cls}
      onClick={async () => {
        if (action.confirm && !(await confirm(action.confirm))) return
        if (!action.onClick) return
        setRunning(true)
        try {
          await action.onClick()
        } finally {
          setRunning(false)
        }
      }}
    >
      {inner}
    </button>
  )
}

export interface DetailHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  status?: ReactNode
  identifiers?: { label: string; value: string; copy?: boolean }[]
  media?: ReactNode
  back?: { href: string; label: string }
  primary?: KitAction
  secondary?: KitAction[]
  /** For actions that are their own client components (DraftEditButton, BrochureButton). */
  actions?: ReactNode
}

/** Header for [id]/view pages: title, status, identifiers and the action row. */
export function DetailHeader({ title, subtitle, status, identifiers, media, back, primary, secondary, actions }: DetailHeaderProps) {
  return (
    <header className="space-y-1.5">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors">
          <span aria-hidden>&lsaquo;</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {media}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-bold text-foreground">{title}</h1>
              {status}
            </div>
            {subtitle && <p className="mt-0.5 text-sm text-foreground-muted">{subtitle}</p>}
            {identifiers && identifiers.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-muted">
                {identifiers.map(id => (
                  <span key={id.label} className="inline-flex min-w-0 items-center gap-1">
                    {id.label} <span className="font-mono text-foreground [overflow-wrap:anywhere]">{id.value}</span>
                    {id.copy && <CopyValue value={id.value} />}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {(primary || secondary?.length || actions) && (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {secondary?.map(a => <ActionButton key={a.key ?? a.label} action={a} />)}
            {actions}
            {primary && <ActionButton action={primary} variant="primary" />}
          </div>
        )}
      </div>
    </header>
  )
}

/** Small copy-to-clipboard button for ids, SKUs and references. */
export function CopyValue({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={e => {
        e.stopPropagation()
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
      className="inline-flex shrink-0 items-center text-foreground-muted hover:text-foreground"
    >
      {done ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
