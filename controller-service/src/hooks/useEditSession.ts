'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type EditSessionStatus = 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'error'

export interface UseEditSessionOptions {
  resourceType: string
  resourceId: string | null
  /** Open as soon as the hook mounts. Default true. Set false to defer until trigger(). */
  autoOpen?: boolean
  /** Called after the session closes with action='cancel' so the editor can reload drafts/state. */
  onCancelled?: () => void
}

export interface UseEditSessionResult {
  sessionId: string | null
  resumed: boolean
  status: EditSessionStatus
  open: () => Promise<void>
  /** Open a fresh session after the current one closed, for editors that stay on the page. */
  reopen: () => Promise<void>
  save: () => Promise<boolean>
  cancel: () => Promise<boolean>
  error: string | null
}

/**
 * Open a session for an admin editor on mount; expose save/cancel for the toolbar.
 *
 * Save = close the session (autosave already carried edits to the draft).
 * Cancel = roll back the draft to the pre-session snapshot, server-side.
 */
export function useEditSession({
  resourceType,
  resourceId,
  autoOpen = true,
  onCancelled,
}: UseEditSessionOptions): UseEditSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [resumed, setResumed] = useState(false)
  const [status, setStatus] = useState<EditSessionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const openedRef = useRef(false)

  const open = useCallback(async () => {
    if (!resourceId || openedRef.current) return
    openedRef.current = true
    setStatus('opening')
    setError(null)
    try {
      const r = await fetch('/api/admin/editor-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }
      const data = await r.json()
      setSessionId(data.session_id)
      setResumed(!!data.resumed)
      setStatus('open')
    } catch (e) {
      openedRef.current = false
      setStatus('error')
      setError((e as Error).message)
    }
  }, [resourceType, resourceId])

  const close = useCallback(
    async (action: 'save' | 'cancel'): Promise<boolean> => {
      if (!sessionId) return false
      setStatus('closing')
      try {
        const r = await fetch(`/api/admin/editor-sessions/${sessionId}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${r.status}`)
        }
        setStatus('closed')
        if (action === 'cancel') onCancelled?.()
        return true
      } catch (e) {
        setStatus('error')
        setError((e as Error).message)
        return false
      }
    },
    [sessionId, onCancelled]
  )

  const reopen = useCallback(async () => {
    openedRef.current = false
    setSessionId(null)
    await open()
  }, [open])

  const save = useCallback(() => close('save'), [close])
  const cancel = useCallback(() => close('cancel'), [close])

  useEffect(() => {
    if (autoOpen && resourceId && !openedRef.current) void open()
  }, [autoOpen, resourceId, open])

  return { sessionId, resumed, status, open, reopen, save, cancel, error }
}
