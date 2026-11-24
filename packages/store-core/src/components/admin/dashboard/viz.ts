// Shared helpers for the dashboard visualisation kit (colours, dates, motion hooks).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

/** Tenant accent shade as an SVG/CSS colour (the theme exposes `--c-accent-<shade>` as "R G B" channels). */
export const acc = (shade: number, alpha?: number) => (alpha == null ? `rgb(var(--c-accent-${shade}))` : `rgb(var(--c-accent-${shade}) / ${alpha})`)

export const NEUTRAL_FILL = 'var(--color-surface-secondary)'
export const NEUTRAL_LINE = 'var(--color-foreground-muted)'
export const GRID_LINE = 'var(--color-border)'

/** Accent shades for the five activity levels (least to most). */
export const LEVEL_SHADES = [200, 300, 400, 600, 800]
export const levelOf = (n: number, max: number) => (n <= 0 || max <= 0 ? -1 : Math.min(4, Math.max(0, Math.ceil((n / max) * 5) - 1)))
export const dotFill = (n: number, max: number) => {
  const l = levelOf(n, max)
  return l < 0 ? NEUTRAL_FILL : acc(LEVEL_SHADES[l])
}

export const CARD_SHADOW = 'shadow-[0_0_0_1px_rgba(0,0,0,.05),0_1px_2px_rgba(0,0,0,.05),0_4px_12px_rgba(0,0,0,.03)] dark:shadow-[0_0_0_1px_rgba(255,255,255,.08)]'
export const TIP_CLASS = 'pointer-events-none absolute z-10 min-w-[8rem] animate-fade-in rounded-xl bg-foreground px-3 py-2 text-[11px] leading-tight text-surface shadow-lg'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const nf = (n: number) => n.toLocaleString('en-IN')
export const dec1 = (n: number) => (Math.round(n * 10) / 10).toString()

const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)
export const fmtShort = (iso: string) => {
  const d = parse(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
export const fmtLong = (iso: string) => {
  const d = parse(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
export const fmtMonth = (iso: string) => {
  const d = parse(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { month: 'short' })
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
      if (!mq) return
      const on = () => setReduced(mq.matches)
      on()
      mq.addEventListener?.('change', on)
      return () => mq.removeEventListener?.('change', on)
    } catch {
      /* no matchMedia */
    }
  }, [])
  return reduced
}

/** Linear 0..1 style tween toward `target` (interruptible); jumps straight there when reduced or without rAF. */
export function useTween(target: number, ms: number, reduced: boolean, initial?: number): number {
  const [v, setV] = useState(reduced || initial == null ? target : initial)
  const cur = useRef(v)
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame === 'undefined') {
      cur.current = target
      setV(target)
      return
    }
    const a = cur.current
    if (a === target) return
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      const x = a + (target - a) * p
      cur.current = x
      setV(x)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, reduced])
  return v
}

export const easeOut = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3)

/** True after mount, for CSS enter transitions (immediately true when reduced). */
export function useMounted(reduced: boolean): boolean {
  const [m, setM] = useState(reduced)
  useEffect(() => {
    if (reduced) {
      setM(true)
      return
    }
    const id = requestAnimationFrame(() => setM(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return m
}

/** Hover/keyboard index for charts made of N slots; arrows move it, Esc/blur clears it. */
export function useIndexNav(n: number) {
  const [idx, setIdx] = useState<number | null>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    if (n <= 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx(i => (i == null ? 0 : Math.min(n - 1, i + 1)))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx(i => (i == null ? n - 1 : Math.max(0, i - 1)))
    } else if (e.key === 'Home') setIdx(0)
    else if (e.key === 'End') setIdx(n - 1)
    else if (e.key === 'Escape') setIdx(null)
  }
  return { idx: idx != null && idx < n ? idx : null, setIdx, onKeyDown }
}

/** Plain line path through points. */
export const linePath = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
/** Safe SVG id fragment from React's useId. */
export const svgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '')

export function pctChange(cur: number, prev: number): number | null {
  return prev ? ((cur - prev) / prev) * 100 : null
}
