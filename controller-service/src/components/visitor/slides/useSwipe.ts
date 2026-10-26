'use client'

import { useRef, useState } from 'react'

const SLOP_PX = 10
const TAP_MS = 300
const CLICK_GUARD_MS = 600

export interface SwipeOptions {
  /** 1 when swiped left (next), -1 when swiped right (previous). */
  onSwipe: (direction: 1 | -1) => void
  threshold?: number
  /** A quick press that barely moved. */
  onTap?: (e: React.PointerEvent<HTMLElement>) => void
  /** Called once the pointer is dragged down past `dragDownPx`. */
  onDragDown?: () => void
  dragDownPx?: number
  /** Capture the pointer on press; only for a layer with no links of its own. */
  capture?: boolean
  enabled?: boolean
}

export interface Swipe {
  /** True while a pointer is held down, so autoplay can pause. */
  pressed: boolean
  bind: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
    onPointerCancel: () => void
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => void
    onDragStart: (e: React.DragEvent<HTMLElement>) => void
  }
}

// Pointer swipe with an axis lock: the first 10px decide, so a vertical scroll never turns into a
// slide change. The element needs `touch-pan-y` (or `touch-none`) so touch moves reach it. A click
// right after a horizontal drag is swallowed, so letting go over a link does not follow it.
export function useSwipe({
  onSwipe,
  threshold = 50,
  onTap,
  onDragDown,
  dragDownPx = 120,
  capture = false,
  enabled = true,
}: SwipeOptions): Swipe {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const axis = useRef<'x' | 'y' | null>(null)
  const draggedAt = useRef(0)
  const [pressed, setPressed] = useState(false)

  const release = () => {
    start.current = null
    axis.current = null
    setPressed(false)
  }

  return {
    pressed,
    bind: {
      onPointerDown: e => {
        if (!enabled || e.button !== 0 || !e.isPrimary) return
        if (capture) e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }
        axis.current = null
        draggedAt.current = 0
        setPressed(true)
      },
      onPointerMove: e => {
        const s = start.current
        if (!s || e.pointerId !== s.id) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        if (onDragDown && dy > dragDownPx) {
          release()
          onDragDown()
          return
        }
        if (axis.current || Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP_PX) return
        axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (axis.current === 'x' && !capture) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // the pointer was already released
          }
        }
      },
      onPointerUp: e => {
        const s = start.current
        if (!s || e.pointerId !== s.id) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        const horizontal = axis.current === 'x'
        release()
        if (horizontal) draggedAt.current = performance.now()
        if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
          onSwipe(dx < 0 ? 1 : -1)
          return
        }
        if (onTap && performance.now() - s.t < TAP_MS && Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) onTap(e)
      },
      onPointerCancel: release,
      onClickCapture: e => {
        if (draggedAt.current && performance.now() - draggedAt.current < CLICK_GUARD_MS) {
          e.preventDefault()
          e.stopPropagation()
        }
        draggedAt.current = 0
      },
      onDragStart: e => e.preventDefault(),
    },
  }
}
