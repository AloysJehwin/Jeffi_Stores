'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import Watermark, { type WatermarkInfo } from './Watermark'

// Deterrence, NOT DRM. A browser cannot block OS screenshots/recorders, so this makes captures
// useless or traceable: hides content the moment a capture shortcut's modifiers go down, while the
// window is unfocused / the pointer has left / the buyer is idle, and stamps a drifting identity
// watermark that stays on top (including in our own fullscreen).

const BLOCKED_KEYS = new Set(['s', 'p', 'c', 'a', 'u']) // Ctrl/Cmd + these
const IDLE_MS = 60_000
const RELEASE_MS = 800
const PRINTSCREEN_MS = 1200

type Reason = 'capture' | 'away' | 'idle'

const focused = () => typeof document.hasFocus !== 'function' || document.hasFocus()
const noModifiers = (e: { metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) =>
  !e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey

/** Modifier states that precede OS capture shortcuts (macOS Cmd+Shift+3/4/5, Windows Win+Shift+S). */
export function isCaptureCombo(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'shiftKey' | 'ctrlKey'>): boolean {
  if (e.key === 'PrintScreen') return true
  if (e.metaKey && e.shiftKey) return true
  if ((e.key === 'Meta' || e.key === 'OS') && e.shiftKey) return true
  return (e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'p'
}

export default function ContentGuard({
  watermark,
  children,
  idleMs = IDLE_MS,
  releaseMs = RELEASE_MS,
}: {
  watermark: WatermarkInfo
  children: React.ReactNode
  idleMs?: number
  releaseMs?: number
}) {
  const [capture, setCapture] = useState(false)
  const [away, setAway] = useState(false)
  const [idle, setIdle] = useState(false)
  const [nativeFs, setNativeFs] = useState(false)
  const [pseudoFs, setPseudoFs] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let captureOn = false
    let idleOn = false
    let releaseTimer: number | undefined
    let idleTimer: number | undefined

    const stop = (e: Event) => e.preventDefault()
    const blocked: (keyof DocumentEventMap)[] = ['selectstart', 'copy', 'cut', 'paste', 'contextmenu', 'dragstart']
    blocked.forEach(ev => document.addEventListener(ev, stop))

    const arm = () => {
      window.clearTimeout(releaseTimer)
      releaseTimer = undefined
      captureOn = true
      setCapture(true)
    }
    // Un-hide only once every modifier is up AND the window has focus; otherwise focus re-schedules.
    const scheduleRelease = (ms: number) => {
      window.clearTimeout(releaseTimer)
      releaseTimer = window.setTimeout(() => {
        releaseTimer = undefined
        if (!focused()) return
        captureOn = false
        setCapture(false)
      }, ms)
    }

    const goIdle = () => {
      // Watching/listening counts as presence; idle only hides documents and paused media.
      const media = Array.from(boxRef.current?.querySelectorAll<HTMLMediaElement>('video, audio') ?? [])
      if (media.some(m => !m.paused && !m.ended)) {
        idleTimer = window.setTimeout(goIdle, idleMs)
        return
      }
      idleOn = true
      setIdle(true)
    }
    const activity = () => {
      if (idleOn) {
        idleOn = false
        setIdle(false)
      }
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(goIdle, idleMs)
    }
    activity()

    const onKeyDown = (e: KeyboardEvent) => {
      activity()
      if (e.key === 'PrintScreen') return onPrintScreen()
      if (isCaptureCombo(e)) arm()
      if ((e.ctrlKey || e.metaKey) && BLOCKED_KEYS.has(e.key?.toLowerCase())) e.preventDefault()
    }
    const onPrintScreen = () => {
      arm()
      navigator.clipboard?.writeText('').catch(() => {})
      scheduleRelease(PRINTSCREEN_MS)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      // Windows often only fires PrintScreen on keyup.
      if (e.key === 'PrintScreen') return onPrintScreen()
      if (captureOn && noModifiers(e)) scheduleRelease(releaseMs)
    }
    // The OS can swallow the final keyup; a plain pointer move proves the modifiers are up.
    const onPointer = (e: Event) => {
      activity()
      if (captureOn && releaseTimer === undefined && noModifiers(e as MouseEvent)) scheduleRelease(releaseMs)
    }

    const onBlur = () => setAway(true)
    const onFocus = () => {
      setAway(false)
      activity()
      if (captureOn) scheduleRelease(releaseMs)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') setAway(true)
      else if (focused()) setAway(false)
    }
    const root = document.documentElement
    const onLeave = () => setAway(true)
    const onEnter = () => focused() && setAway(false)

    const onFsChange = () => {
      const el = document.fullscreenElement
      // A native <video> fullscreen would escape the watermark layer: pull it back out.
      if (el && el !== boxRef.current && boxRef.current?.contains(el)) document.exitFullscreen?.().catch(() => {})
      setNativeFs(!!el && el === boxRef.current)
    }

    if (document.visibilityState === 'hidden') setAway(true)

    const activityEvents = ['pointerdown', 'touchstart', 'wheel', 'scroll'] as const
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('mousemove', onPointer, { passive: true })
    activityEvents.forEach(ev => document.addEventListener(ev, activity, { passive: true, capture: true }))
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    root.addEventListener('mouseleave', onLeave)
    root.addEventListener('mouseenter', onEnter)
    document.addEventListener('fullscreenchange', onFsChange)

    return () => {
      window.clearTimeout(releaseTimer)
      window.clearTimeout(idleTimer)
      blocked.forEach(ev => document.removeEventListener(ev, stop))
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('pointermove', onPointer)
      document.removeEventListener('mousemove', onPointer)
      activityEvents.forEach(ev => document.removeEventListener(ev, activity, true))
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
      root.removeEventListener('mouseleave', onLeave)
      root.removeEventListener('mouseenter', onEnter)
      document.removeEventListener('fullscreenchange', onFsChange)
    }
  }, [idleMs, releaseMs])

  useEffect(() => {
    if (!pseudoFs) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPseudoFs(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pseudoFs])

  // Fullscreen the guard container (watermark + overlay included), never the bare media element.
  // iPhone Safari has no element fullscreen, so fall back to a fixed full-viewport layer.
  const toggleFullscreen = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    if (document.fullscreenElement) return void document.exitFullscreen?.().catch(() => {})
    if (pseudoFs) return setPseudoFs(false)
    if (typeof box.requestFullscreen === 'function') box.requestFullscreen().catch(() => setPseudoFs(true))
    else setPseudoFs(true)
  }, [pseudoFs])

  const reason: Reason | null = capture ? 'capture' : away ? 'away' : idle ? 'idle' : null
  const fs = nativeFs || pseudoFs

  return (
    <div>
      <style>{`@media print { .vault-protected { display: none !important; } body::after { content: 'Printing is disabled for protected content.'; } }`}</style>
      <div
        ref={boxRef}
        data-obscured={reason ? 'true' : 'false'}
        className={`vault-protected relative select-none ${fs ? 'bg-neutral-950' : ''} ${pseudoFs ? 'fixed inset-0 z-[100]' : ''}`}
        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        onContextMenu={e => e.preventDefault()}
      >
        <div
          className={fs ? 'flex h-full flex-col justify-center overflow-auto p-4 pt-[max(1rem,env(safe-area-inset-top))]' : undefined}
          style={{ filter: reason ? 'blur(28px)' : undefined, transition: 'filter 120ms' }}
        >
          {children}
        </div>
        <Watermark info={watermark} />
        {reason ? (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-1 bg-neutral-950/95 px-6 text-center">
            <p className="text-sm font-medium text-neutral-200">Content hidden</p>
            <p className="text-xs text-neutral-500">
              {reason === 'idle'
                ? 'Hidden while inactive — move the pointer, tap or press a key to continue.'
                : reason === 'away'
                  ? 'Return to this window to keep viewing.'
                  : 'Release the keys to keep viewing.'}
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={fs ? 'Exit fullscreen' : 'Fullscreen'}
          title={fs ? 'Exit fullscreen' : 'Fullscreen'}
          className="absolute right-2 top-2 z-[60] inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white/80 ring-1 ring-white/10 backdrop-blur transition hover:bg-black/75 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          style={pseudoFs ? { top: 'max(0.5rem, env(safe-area-inset-top))', right: 'max(0.5rem, env(safe-area-inset-right))' } : undefined}
        >
          {fs ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        Watermarked with your identity. Browsers can&apos;t fully block screenshots or screen recording, so content
        hides when you look away or go idle. Sharing it breaks its licence.
      </p>
    </div>
  )
}
