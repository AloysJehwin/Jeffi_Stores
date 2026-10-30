'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import type { EditSessionStatus } from '@/hooks/useEditSession'
import { Badge } from './core'

// Edit-session chrome for the Tabs `actions` slot: autosave pill + Draft chip +
// optional inline Restore/Discard (when the caller passes handlers) + Cancel.

export interface EditSessionActionsProps {
  autosaveStatus: AutosaveStatus
  sessionStatus: EditSessionStatus
  onCancel: () => Promise<boolean>
  cancelHref?: string | null
  cancelLabel?: string
  draft?: boolean
  disabled?: boolean
  /** When set, a newer local autosave exists — render Restore + Discard inline. */
  restore?: () => void
  /** Plain draft discard — rendered only when `restore` is not set. */
  discard?: () => void
  /** Someone else holds the draft: hide Cancel / Restore; Discard only when passed (owner roles). */
  readOnly?: boolean
}

export function EditSessionActions({
  autosaveStatus,
  sessionStatus,
  onCancel,
  cancelHref = null,
  cancelLabel = 'Cancel',
  draft = false,
  disabled = false,
  restore,
  discard,
  readOnly = false,
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

  if (readOnly) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <AutosaveStatusPill status="locked" />
        {discard && (
          <button
            type="button"
            onClick={discard}
            className="h-control inline-flex items-center rounded-lg border border-border-secondary bg-surface px-3 text-sm text-foreground-secondary transition-colors hover:bg-surface-secondary"
          >
            Discard
          </button>
        )}
      </div>
    )
  }

  const localNewer = !!restore
  const showDiscardInline = localNewer || !!discard
  const draftTooltip = localNewer
    ? 'A newer local autosave exists for this draft.'
    : 'Editing a draft. The live record is unchanged until you publish.'

  return (
    <div className="flex flex-wrap items-center gap-2">
      {autosaveStatus !== 'idle' && <AutosaveStatusPill status={autosaveStatus} />}
      {localNewer && (
        <button
          type="button"
          onClick={restore}
          title={draftTooltip}
          className="h-control inline-flex items-center rounded-lg border border-accent-500/40 bg-accent-500/10 px-3 text-sm font-semibold text-accent-500 transition-colors hover:bg-accent-500/20"
        >
          Restore
        </button>
      )}
      {showDiscardInline && (
        <button
          type="button"
          onClick={discard}
          title={draftTooltip}
          className="h-control inline-flex items-center rounded-lg border border-border-secondary bg-surface px-3 text-sm text-foreground-secondary transition-colors hover:bg-surface-secondary"
        >
          Discard
        </button>
      )}
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
