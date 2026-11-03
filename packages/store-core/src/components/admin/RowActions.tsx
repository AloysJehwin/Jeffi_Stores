'use client'

import type { LucideIcon } from 'lucide-react'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import IconButton from '@/components/ui/IconButton'
import { ACTION_ICONS, type ActionKind } from '@/components/admin/action-icons'

type ConfirmSpec = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
}

export interface RowAction {
  key: string
  /** Pulls default icon/label/danger from ACTION_ICONS. */
  kind?: ActionKind
  /** Override label (required if no `kind`). Used for aria-label + tooltip. */
  label?: string
  /** Override icon. */
  icon?: LucideIcon
  variant?: 'default' | 'accent' | 'danger'
  /** Link action … */
  href?: string
  target?: string
  download?: boolean
  /** … or button action. */
  onSelect?: () => void | Promise<void>
  disabled?: boolean
  busy?: boolean
  /** Marks the action destructive (red) and auto-confirms before running. */
  danger?: boolean
  /** Conditional actions: compute inline and pass hidden to drop them. */
  hidden?: boolean
  /** Per-item write-scope gate; hidden when the admin lacks it. */
  scope?: string
  /** Explicit confirm spec. A danger action with no spec gets a default danger confirm. */
  confirm?: string | ConfirmSpec
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
}

interface RowActionsProps {
  actions: RowAction[]
  size?: 'sm' | 'md'
  className?: string
}

export default function RowActions({ actions, size = 'sm', className = '' }: RowActionsProps) {
  return (
    <div className={`flex items-center justify-end gap-1 ${className}`}>
      {actions.map(a => (
        <ActionItem key={a.key} action={a} size={size} />
      ))}
    </div>
  )
}

// One component instance per action so useCanWrite can be called at the top level (hooks rule-safe as long
// as callers keep a stable key order and use `hidden` rather than removing entries).
function ActionItem({ action, size }: { action: RowAction; size: 'sm' | 'md' }) {
  const confirm = useConfirm()
  const canWrite = useCanWrite(action.scope ?? '')
  const def = action.kind ? ACTION_ICONS[action.kind] : undefined

  if (action.hidden) return null
  if (action.scope && !canWrite) return null

  const icon = action.icon ?? def?.icon
  const label = action.label ?? def?.label
  if (!icon || !label) return null // misconfigured action; skip rather than crash

  const danger = action.danger ?? def?.danger ?? false
  const variant = action.variant ?? (danger ? 'danger' : 'default')

  if (action.href !== undefined) {
    return (
      <IconButton
        icon={icon}
        label={label}
        variant={variant}
        size={size}
        href={action.href}
        target={action.target}
        download={action.download}
        disabled={action.disabled}
        busy={action.busy}
        tooltipPosition={action.tooltipPosition}
      />
    )
  }

  const handleClick = async () => {
    if (!action.onSelect) return
    const spec: ConfirmSpec | undefined =
      action.confirm !== undefined
        ? typeof action.confirm === 'string'
          ? { message: action.confirm }
          : action.confirm
        : danger
          ? { title: label, message: `${label}?`, confirmLabel: label, variant: 'danger' }
          : undefined
    if (spec) {
      const ok = await confirm(spec)
      if (!ok) return
    }
    await action.onSelect()
  }

  return (
    <IconButton
      icon={icon}
      label={label}
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={action.disabled}
      busy={action.busy}
      tooltipPosition={action.tooltipPosition}
    />
  )
}
