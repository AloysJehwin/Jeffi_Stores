'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isDraftLockedError } from '@/lib/client/draft-lock-client'

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'locked'

interface Options<T> {
  /** Debounce in ms before firing the save. Default 1500. */
  debounceMs?: number
  /** How long to hold the 'saved' state before falling back to 'idle'. Default 2500. */
  savedPillMs?: number
  /** The POST/PATCH callback. Must throw on non-2xx so status flips to 'error'. */
  save: (value: T, signal: AbortSignal) => Promise<void>
  /** Guard — return false to skip this autosave cycle (e.g. no draft id yet, invalid state). */
  enabled?: (value: T) => boolean
  /** The save got 423 (someone else holds the draft): autosave stops; the editor goes read-only. */
  onLocked?: (err: unknown, unsaved: T) => void
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
  onLocked,
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
  // After a 423 nothing retries until the editor calls resume() (lock regained).
  const lockedRef = useRef(false)
  const onLockedRef = useRef(onLocked)
  onLockedRef.current = onLocked
  const stopLocked = useCallback((err: unknown, value: T) => {
    lockedRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setStatus('locked')
    onLockedRef.current?.(err, value)
  }, [])

  const trigger = useCallback(
    (value: T) => {
      if (lockedRef.current) return
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
          if (isDraftLockedError(err)) return stopLocked(err, value)
          setStatus('error')
        }
      }, debounceMs)
    },
    [debounceMs, savedPillMs, enabled, stopLocked]
  )

  // Flush immediately (bypass debounce) — call before navigation / before
  // publish to make sure the latest edit lands server-side.
  const flush = useCallback(async (value: T) => {
    if (lockedRef.current) throw new Error('This draft is read-only')
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('saving')
    try {
      await saveRef.current(value, ctrl.signal)
      setStatus('saved')
    } catch (err) {
      if (isDraftLockedError(err)) stopLocked(err, value)
      else if ((err as { name?: string })?.name !== 'AbortError') setStatus('error')
      throw err
    }
  }, [stopLocked])

  const resume = useCallback(() => {
    lockedRef.current = false
    setStatus('idle')
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  return { status, trigger, flush, resume }
}

/** Pill text — centralises the copy so every editor says the same thing. */
export function autosaveLabel(status: AutosaveStatus): string {
  if (status === 'saving') return 'Saving…'
  if (status === 'saved') return 'Draft saved'
  if (status === 'error') return 'Save failed'
  if (status === 'locked') return 'Read-only'
  return 'Draft'
}
