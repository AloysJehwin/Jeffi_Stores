import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { PanResponder, type GestureResponderHandlers } from 'react-native'
import { useMotion, useScreenReader } from './motion'

/**
 * A horizontal swipe on a surface that doesn't scroll (the crossfade heroes): `onSwipe(1)` for a swipe left
 * (next), `-1` for right. Spread the handlers on the surface; pass a stable callback.
 */
export function useSwipe(onSwipe: (dir: 1 | -1) => void, threshold = 50): GestureResponderHandlers {
  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > threshold) onSwipe(g.dx < 0 ? 1 : -1)
        },
      }).panHandlers,
    [onSwipe, threshold]
  )
}

// True while a vertical feed is dragged or flung: an autoplaying pager waits for it to settle, so its
// page change and crossfade don't land mid-scroll.
let feedScrolling = false
const feedListeners = new Set<() => void>()
export function setFeedScrolling(on: boolean) {
  if (feedScrolling === on) return
  feedScrolling = on
  feedListeners.forEach(l => l())
}

const subscribeFeed = (l: () => void) => {
  feedListeners.add(l)
  return () => feedListeners.delete(l)
}

/** False while the feed is dragged or flung. */
export const useFeedSettled = () => !useSyncExternalStore(subscribeFeed, () => feedScrolling)

export interface Autoplay {
  /** Give the current slide its full interval again; call on every page change (swipe or auto). */
  restart: () => void
  /** Hold while a finger is down; releasing restarts the interval. */
  hold: (down: boolean) => void
}

/**
 * Calls `advance` every `intervalMs`. Off under reduced motion or a screen reader; while held (or while the
 * feed scrolls) it retries shortly instead of advancing under the finger.
 */
export function useAutoplay(advance: () => void, { enabled = true, intervalMs = 5000 }: { enabled?: boolean; intervalMs?: number } = {}): Autoplay {
  const { animate } = useMotion()
  const reader = useScreenReader()
  const on = enabled && animate && !reader
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const latest = useRef({ advance, on, intervalMs })
  latest.current = { advance, on, intervalMs }

  const auto = useMemo<Autoplay & { schedule: (delay: number) => void }>(() => {
    const schedule = (delay: number) => {
      if (timer.current) clearTimeout(timer.current)
      if (!latest.current.on) return
      timer.current = setTimeout(() => {
        if (held.current || feedScrolling) return schedule(600)
        latest.current.advance()
      }, delay)
    }
    return {
      schedule,
      restart: () => schedule(latest.current.intervalMs),
      hold: down => {
        held.current = down
        if (!down) schedule(latest.current.intervalMs)
      },
    }
  }, [])

  useEffect(() => {
    auto.schedule(intervalMs)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [auto, on, intervalMs])

  return auto
}
