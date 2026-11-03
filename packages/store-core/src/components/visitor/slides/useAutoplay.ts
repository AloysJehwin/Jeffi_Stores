'use client'

import { useEffect, useRef, useState } from 'react'
import { useMotionValue, useReducedMotion, type MotionValue } from 'motion/react'

export interface AutoplayOptions {
  durationMs: number
  /** Restarts the clock when it changes: the current slide, or anything that identifies it. */
  resetKey: unknown
  onComplete: () => void
  /** False keeps the clock stopped (one slide, autoplay off). */
  enabled?: boolean
  /** An outside pause, such as a held pointer. */
  paused?: boolean
  /** Keep running under reduced motion when the progress bar is the only cue left (stories). */
  ignoreReducedMotion?: boolean
}

export interface Autoplay {
  /** 0→1 over durationMs; resumes from where it paused. 1 under reduced motion. */
  progress: MotionValue<number>
  running: boolean
  reduced: boolean
  /** Spread on the container: hover (mouse only) and keyboard focus inside pause the clock. */
  bind: {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => void
    onFocus: (e: React.FocusEvent<HTMLElement>) => void
    onBlur: (e: React.FocusEvent<HTMLElement>) => void
  }
}

// A click leaves focus on the arrow or dot; only keyboard focus should hold the slide.
function focusVisible(el: EventTarget): boolean {
  try {
    return (el as Element).matches(':focus-visible')
  } catch {
    return true
  }
}

// One rAF clock for a slide: it drives the advance and any progress bar or drift tied to it, so
// pausing stops them all. Pauses on hover, keyboard focus inside, a hidden tab, `paused`, and
// reduced motion.
export function useAutoplay({
  durationMs,
  resetKey,
  onComplete,
  enabled = true,
  paused = false,
  ignoreReducedMotion = false,
}: AutoplayOptions): Autoplay {
  const reduced = !!useReducedMotion() && !ignoreReducedMotion
  const progress = useMotionValue(0)
  const elapsedRef = useRef(0)
  const completeRef = useRef(onComplete)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    completeRef.current = onComplete
  })

  useEffect(() => {
    elapsedRef.current = 0
    progress.set(reduced ? 1 : 0)
  }, [resetKey, reduced, progress])

  const running = enabled && !reduced && !hidden && !hovered && !focused && !paused
  useEffect(() => {
    if (!running) return
    let frame = 0
    const started = performance.now() - elapsedRef.current
    const tick = (now: number) => {
      const elapsed = now - started
      elapsedRef.current = elapsed
      const p = Math.min(1, elapsed / durationMs)
      progress.set(p)
      if (p >= 1) {
        completeRef.current()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, durationMs, progress, resetKey])

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return {
    progress,
    running,
    reduced,
    bind: {
      onPointerEnter: e => {
        if (e.pointerType === 'mouse') setHovered(true)
      },
      onPointerLeave: e => {
        if (e.pointerType === 'mouse') setHovered(false)
      },
      onFocus: e => {
        if (focusVisible(e.target)) setFocused(true)
      },
      onBlur: e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      },
    },
  }
}
