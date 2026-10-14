'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Options<T> {
  /** Debounce in ms before firing the save. Default 1500. */
  debounceMs?: number
  /** How long to hold the 'saved' state before falling back to 'idle'. Default 2500. */
  savedPillMs?: number
  /** The POST/PATCH callback. Must throw on non-2xx so status flips to 'error'. */
  save: (value: T, signal: AbortSignal) => Promise<void>
  /** Guard — return false to skip this autosave cycle (e.g. no draft id yet, invalid state). */
  enabled?: (value: T) => boolean
}

/**
 * One hook, one debounce, one status machine — used by every admin editor that
 * autosaves to a /draft endpoint. Replaces the hand-rolled useRef<setTimeout>
 * loops that lived in mailer + review-forms + products (slightly different
 * debounces, slightly different enums). AbortController cancels in-flight
 * requests when a new one supersedes them.
 */
export function useAutosaveDraft<T>({
  save,
  debounceMs = 1500,
  savedPillMs = 2500,
  enabled,
}: Options<T>) {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep latest save fn without re-triggering the memo (callers often pass a
  // fresh closure each render).
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])

  const trigger = useCallback(
    (value: T) => {
      if (enabled && !enabled(value)) return
      if (timerRef.current) clearTimeout(timerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      setStatus('saving')
      timerRef.current = setTimeout(async () => {
        if (abortRef.current) abortRef.current.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        try {
          await saveRef.current(value, ctrl.signal)
          if (ctrl.signal.aborted) return
          setStatus('saved')
          savedTimerRef.current = setTimeout(() => setStatus('idle'), savedPillMs)
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError') return
          setStatus('error')
        }
      }, debounceMs)
    },
    [debounceMs, savedPillMs, enabled]
  )

  // Flush immediately (bypass debounce) — call before navigation / before
  // publish to make sure the latest edit lands server-side.
  const flush = useCallback(async (value: T) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('saving')
    try {
      await saveRef.current(value, ctrl.signal)
      setStatus('saved')
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') setStatus('error')
      throw err
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  return { status, trigger, flush }
}

/** Pill text — centralises the copy so every editor says the same thing. */
export function autosaveLabel(status: AutosaveStatus): string {
  if (status === 'saving') return 'Saving…'
  if (status === 'saved') return 'Draft saved'
  if (status === 'error') return 'Save failed'
  return 'Draft'
}
