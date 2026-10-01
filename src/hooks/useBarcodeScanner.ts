'use client'

import { useEffect, useRef } from 'react'

/**
 * Hardware barcode scanner support (keyboard-wedge).
 *
 * USB/Bluetooth barcode scanners emulate a keyboard: they "type" the code far
 * faster than a human (typically <30ms between characters) and finish with an
 * Enter keypress. This hook watches global keydown events, buffers fast bursts,
 * and fires `onScan(code)` when a burst ends in Enter — while ignoring normal
 * human typing and (by default) keystrokes aimed at an editable field.
 */

interface Options {
  onScan: (code: string) => void
  enabled?: boolean
  /** Max ms between keystrokes to still count as one scan burst. Default 60ms. */
  maxIntervalMs?: number
  /** Minimum characters for a valid scan. Default 3. */
  minLength?: number
  /**
   * If true, also capture when an input/textarea/select is focused. Default false
   * (so typing in a search box isn't hijacked). Set true for a dedicated scan mode.
   */
  captureInInputs?: boolean
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
  maxIntervalMs = 60,
  minLength = 3,
  captureInInputs = false,
}: Options) {
  // Keep the latest onScan without re-binding the listener each render.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const bufferRef = useRef('')
  const lastKeyTimeRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    function handleKeydown(e: KeyboardEvent) {
      // A dedicated scan box (marked data-scan-box) owns its own burst + Enter
      // handling, so the global hook must ignore it entirely — otherwise a scan
      // into the box would be processed twice (box handler + this hook).
      const t = e.target
      if (t instanceof HTMLElement && t.closest('[data-scan-box]')) return

      if (!captureInInputs && isEditableTarget(e.target)) return

      const now = Date.now()
      const prevKeyTime = lastKeyTimeRef.current
      const gap = now - prevKeyTime
      lastKeyTimeRef.current = now

      // A slow keystroke breaks the burst (human typing) — reset the buffer.
      // But never treat the FIRST key of a fresh burst as a break: prevKeyTime is
      // 0/stale then, so `gap` is huge and would wrongly clear the first character.
      if (prevKeyTime !== 0 && gap > maxIntervalMs && bufferRef.current.length > 0) {
        bufferRef.current = ''
      }

      if (e.key === 'Enter') {
        const code = bufferRef.current
        bufferRef.current = ''
        if (code.length >= minLength) {
          // Prevent the Enter from submitting a form / triggering other handlers.
          e.preventDefault()
          e.stopPropagation()
          onScanRef.current(code)
        }
        return
      }

      // Only accumulate printable single characters (scanners emit these).
      // When capturing globally (captureInInputs) AND a burst is already in progress
      // (this char arrived <maxIntervalMs after the previous one), swallow it so a
      // scan performed while a normal text field is focused doesn't ALSO type the code
      // into that field. The FIRST char of a burst is let through (we can't yet tell a
      // scan from human typing), so slow manual typing into inputs is never blocked —
      // only the fast follow-on chars of a genuine scanner burst are suppressed.
      if (e.key.length === 1) {
        if (
          captureInInputs &&
          isEditableTarget(e.target) &&
          prevKeyTime !== 0 &&
          gap <= maxIntervalMs &&
          bufferRef.current.length > 0
        ) {
          e.preventDefault()
          e.stopPropagation()
        }
        bufferRef.current += e.key
      }
    }

    // Capture phase so we see the keys before focused inputs consume them.
    window.addEventListener('keydown', handleKeydown, true)
    return () => window.removeEventListener('keydown', handleKeydown, true)
  }, [enabled, maxIntervalMs, minLength, captureInInputs])
}
