'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import AutosaveStatusPill from './AutosaveStatusPill'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import type { EditSessionStatus } from '@/hooks/useEditSession'

interface Props {
  autosaveStatus: AutosaveStatus
  sessionStatus: EditSessionStatus
  onSave: () => void | Promise<void>
  onCancel: () => Promise<boolean>
  /** Where to navigate after Cancel succeeds. If null/undefined, caller handles navigation. */
  cancelHref?: string | null
  saveLabel?: string
  cancelLabel?: string
  /** Hide the Save button (e.g. an editor whose Save is the <form> submit button). */
  hideSave?: boolean
  /** Hide the Cancel button (rare, mostly for the "Save as Draft" + "Publish" dual-submit editors). */
  hideCancel?: boolean
  disabled?: boolean
}

export default function EditorToolbar({
  autosaveStatus,
  sessionStatus,
  onSave,
  onCancel,
  cancelHref = null,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  hideSave = false,
  hideCancel = false,
  disabled = false,
}: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const busy = sessionStatus === 'closing' || sessionStatus === 'opening' || disabled

  const handleCancel = async () => {
    if (!confirming) {
      setConfirming(true)
      // Auto-reset after 4s so the user doesn't get stuck in the confirm state.
      setTimeout(() => setConfirming(false), 4000)
      return
    }
    const ok = await onCancel()
    setConfirming(false)
    if (ok && cancelHref) router.push(cancelHref)
  }

  return (
    <div className="flex items-center gap-3">
      <AutosaveStatusPill status={autosaveStatus} />
      {!hideCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className={`px-3 py-1.5 text-sm rounded border transition ${
            confirming
              ? 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
              : 'bg-surface-primary text-foreground-primary border-border-default hover:bg-surface-secondary'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {confirming ? 'Discard changes?' : cancelLabel}
        </button>
      )}
      {!hideSave && (
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {saveLabel}
        </button>
      )}
    </div>
  )
}
