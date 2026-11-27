import { EDITOR_BREAKPOINTS, type Breakpoint } from '@jeffi/site-blocks/design'
import { effectiveValue, readClasses, setOwn, setPanelValue, type PanelProp } from './classes'

// Free layers (docs/plans/SITE_EDITOR_PLAN.md phase 3): an element placed Canva-style, `absolute` inside its frame (the
// nearest positioned ancestor, the section made `relative`), with its left, top, width and maybe height in % of the
// frame at a breakpoint: `lg:absolute lg:left-[12%] lg:top-[30%] lg:w-[40%] lg:z-10`. Below the breakpoint it is
// placed at, it is in the flow at its place in the tree (reading order and SEO unchanged) unless placed there too.
// Pure: the editor runs it in the browser; the compile checks the classes again on save.

export interface FreeRect {
  /** % of the frame's width (left, width) and height (top, height). */
  left: number
  top: number
  width: number
  /** Unset: as tall as its content. */
  height?: number
}

export interface FreeLayer {
  /** The breakpoint its placement comes from (this one, or a narrower one it carries up from). */
  from: Breakpoint
  rect: FreeRect
  /** Stacking among the frame's layers (z-index). */
  z: number
  /** Degrees, -180..180; left out when not rotated. */
  rotate?: number
}

/** A percentage class value: 0–100 with at most one decimal, `[12.5%]`. */
export const pct = (n: number) => `[${Math.round(Math.max(-100, Math.min(200, n)) * 10) / 10}%]`
const readPct = (v: string | undefined): number | undefined => {
  const m = v ? /^(-?)\[(-?[\d.]+)%\]$/.exec(v) : null
  return m ? Number(m[2]) * (m[1] ? -1 : 1) : undefined
}
const readZ = (v: string | undefined) => {
  if (!v) return 0
  const m = /^(-?)(?:\[)?(\d+)\]?$/.exec(v)
  return m ? Number(m[2]) * (m[1] ? -1 : 1) : 0
}

/** A rotation class value (`[12deg]`, `[-12deg]`, `-[12deg]`, `12`, `-12`) in whole degrees. */
const readDeg = (v: string | undefined): number => {
  const m = v ? /^(-?)(?:\[(-?[\d.]+)deg\]|(\d+))$/.exec(v) : null
  return m ? clampDeg(Number(m[2] ?? m[3]) * (m[1] ? -1 : 1)) : 0
}
/** Whole degrees in -180..180. */
export const clampDeg = (n: number) => {
  const d = Math.round(((((n + 180) % 360) + 360) % 360) - 180)
  return d === -180 && n > 0 ? 180 : d
}

/** A z-index class value: Tailwind's steps, else an arbitrary one. */
export const zValue = (n: number) => ([0, 10, 20, 30, 40, 50].includes(n) ? String(n) : `[${Math.round(n)}]`)

const rank = (bp: Breakpoint) => (['base', 'sm', 'md', 'lg', 'xl', '2xl'] as Breakpoint[]).indexOf(bp)
const upOf = (bp: Breakpoint) => EDITOR_BREAKPOINTS.find(b => rank(b) > rank(bp))

/** The element's placement at a breakpoint, or null when it is in the flow there. */
export function freeAt(className: string, bp: Breakpoint): FreeLayer | null {
  const pos = effectiveValue(className, bp, 'position')
  if (pos?.value !== 'absolute') return null
  const left = readPct(effectiveValue(className, bp, 'left')?.value)
  const top = readPct(effectiveValue(className, bp, 'top')?.value)
  const width = readPct(effectiveValue(className, bp, 'width')?.value)
  if (left === undefined || top === undefined || width === undefined) return null
  const height = readPct(effectiveValue(className, bp, 'height')?.value)
  const rotate = rotateAt(className, bp)
  return { from: pos.from, rect: { left, top, width, ...(height !== undefined ? { height } : {}) }, z: readZ(effectiveValue(className, bp, 'zIndex')?.value), ...(rotate ? { rotate } : {}) }
}

/** The rotation in effect at a breakpoint, in degrees (0: none). */
export const rotateAt = (className: string, bp: Breakpoint) => readDeg(effectiveValue(className, bp, 'rotate')?.value)

/** The classes with a rotation at a breakpoint (0 clears it); wider breakpoints that inherited the old one keep it. */
export const setRotate = (className: string, bp: Breakpoint, deg: number) => {
  const d = clampDeg(deg)
  return setPanelValue(className, bp, 'rotate', d === 0 ? null : `[${d}deg]`)
}

/** Whether a breakpoint's placement is its own (not carried up from a narrower one). */
export const placedHere = (className: string, bp: Breakpoint) => readClasses(className).values[bp].position === 'absolute'

/**
 * The classes with the element placed at a breakpoint. The next breakpoint up that was in the flow (nothing of its own,
 * nothing placed below) stays in the flow: `static` and its old width pinned there, as editing one breakpoint leaves
 * the wider ones as they were. To carry a placement up, place the wider breakpoint too.
 */
export function placeFree(className: string, bp: Breakpoint, rect: FreeRect, z?: number): string {
  const up = upOf(bp)
  const flowAbove = up && !freeAt(className, up) && readClasses(className).values[up].position === undefined
  let next = className
  const set = (prop: PanelProp, value: string | null) => (next = setPanelValue(next, bp, prop, value))
  const widthAbove = up ? effectiveValue(className, up, 'width')?.value : undefined
  const heightAbove = up ? effectiveValue(className, up, 'height')?.value : undefined
  set('position', 'absolute')
  set('left', pct(rect.left))
  set('top', pct(rect.top))
  set('width', pct(rect.width))
  // No height: as tall as its content, so a % height of its own goes (an auto one stays).
  if (rect.height !== undefined) set('height', pct(rect.height))
  else if (readPct(readClasses(next).values[bp].height) !== undefined) set('height', null)
  set('zIndex', zValue(z ?? (freeAt(className, bp)?.z || 10)))
  if (up && flowAbove) {
    const pin = (prop: PanelProp, value: string) => readClasses(next).values[up][prop] === undefined && (next = setOwn(next, up, prop, value))
    pin('position', 'static')
    pin('width', widthAbove ?? 'auto')
    if (rect.height !== undefined) pin('height', heightAbove ?? 'auto')
  }
  return next
}

/**
 * The classes with the element back in the flow at a breakpoint: its own placement cleared, and, when a narrower
 * breakpoint's would carry up, `static` and an auto width so it sits at its place in the tree.
 */
export function unplaceFree(className: string, bp: Breakpoint): string {
  let next = className
  for (const prop of ['position', 'left', 'top', 'width', 'height', 'zIndex', 'rotate'] as PanelProp[]) {
    const own = readClasses(next).values[bp][prop]
    // A width the author gave (w-full) stays; the placement's % one goes.
    if (own !== undefined && ((prop !== 'width' && prop !== 'height') || readPct(own) !== undefined)) next = setPanelValue(next, bp, prop, null)
  }
  if (freeAt(next, bp)) {
    next = setPanelValue(next, bp, 'position', 'static')
    next = setPanelValue(next, bp, 'width', 'auto')
    if (effectiveValue(next, bp, 'height')) next = setPanelValue(next, bp, 'height', 'auto')
  }
  return next
}

/**
 * The frame's classes for a layer placed in it at a breakpoint: `relative` when nothing positions it, and, when nothing
 * sets its height there, its current height in px as a minimum, so it keeps its size once the layer leaves the flow.
 */
export function frameFor(className: string, bp: Breakpoint, heightPx: number | null): string {
  let next = className
  if (!effectiveValue(next, bp, 'position')) next = setPanelValue(next, 'base', 'position', 'relative')
  if (heightPx && heightPx > 0 && !effectiveValue(next, bp, 'minHeight') && !effectiveValue(next, bp, 'height'))
    next = setPanelValue(next, bp, 'minHeight', `[${Math.round(heightPx)}px]`)
  return next
}

/** Layers in a frame ordered back to front: a z among theirs, one step past the top or under the bottom. */
export function restack(zs: number[], z: number, dir: 'front' | 'back' | 'forward' | 'backward'): number {
  const sorted = [...new Set(zs)].sort((a, b) => a - b)
  const top = sorted[sorted.length - 1] ?? z
  const bottom = sorted[0] ?? z
  if (dir === 'front') return z === top ? z : Math.min(50, top + 10)
  if (dir === 'back') return z === bottom ? z : Math.max(0, bottom - 10)
  const i = sorted.indexOf(z)
  const other = dir === 'forward' ? sorted[i + 1] : sorted[i - 1]
  if (other === undefined) return z
  return dir === 'forward' ? Math.min(50, other + 1) : Math.max(0, other - 1)
}
