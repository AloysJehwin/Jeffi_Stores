'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import type { EditSessionStatus } from '@/hooks/useEditSession'
import { Badge } from './core'

// Edit-session chrome for the Tabs `actions` slot: autosave pill + Draft chip + Cancel.
// Markup only; the hooks that drive status/save/cancel stay with the caller.

export interface EditSessionActionsProps {
  autosaveStatus: AutosaveStatus
  sessionStatus: EditSessionStatus
  onCancel: () => Promise<boolean>
  cancelHref?: string | null
  cancelLabel?: string
  /** Show a 'Draft' chip when the session is unpublished. */
  draft?: boolean
  disabled?: boolean
}

export function EditSessionActions({
  autosaveStatus,
  sessionStatus,
  onCancel,
  cancelHref = null,
  cancelLabel = 'Cancel',
  draft = false,
  disabled = false,
}: EditSessionActionsProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const busy = sessionStatus === 'closing' || sessionStatus === 'opening' || disabled

  const handleCancel = async () => {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 4000)
      return
    }
    const ok = await onCancel()
    setConfirming(false)
    if (ok && cancelHref) router.push(cancelHref)
  }

  return (
    <div className="flex items-center gap-2">
      <AutosaveStatusPill status={autosaveStatus} />
      {draft && <Badge tone="amber">Draft</Badge>}
      <button
        type="button"
        onClick={handleCancel}
        disabled={busy}
        className={`h-control inline-flex items-center rounded-lg border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          confirming
            ? 'border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20'
            : 'border-border-secondary bg-surface text-foreground hover:bg-surface-secondary'
        }`}
      >
        {confirming ? 'Discard changes?' : cancelLabel}
      </button>
    </div>
  )
}
