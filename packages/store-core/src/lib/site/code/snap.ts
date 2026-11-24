// Snapping for free layers' move and resize handles, in % of the frame. An edge (or the centre) within `tol` of a
// guide lands on it: the frame's edges, centre and Tailwind's fractions, and the other layers' and elements' edges and
// centres. Anything else lands on whole percents. Pure and tiny: the canvas bridge loads it.

export interface Box {
  left: number
  top: number
  width: number
  height: number
}
export interface Guides {
  x: number[]
  y: number[]
}
export interface Snapped {
  box: Box
  /** The guides it landed on, to draw. */
  lines: { x: number[]; y: number[] }
}
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const FRACTIONS = [0, 25, 100 / 3, 50, 200 / 3, 75, 100]
const MIN = 2

/** The frame's guides plus the edges and centres of the boxes beside the one moving. */
export function guidesFor(others: Box[]): Guides {
  const x = [...FRACTIONS]
  const y = [0, 50, 100]
  for (const b of others) {
    x.push(b.left, b.left + b.width / 2, b.left + b.width)
    y.push(b.top, b.top + b.height / 2, b.top + b.height)
  }
  return { x, y }
}

const round = (n: number) => Math.round(n)
const near = (v: number, list: number[], tol: number) => {
  let best: number | null = null
  for (const g of list) if (Math.abs(g - v) <= tol && (best === null || Math.abs(g - v) < Math.abs(best - v))) best = g
  return best
}

/** The offset that puts one of `points` (in order of preference) on a guide, or null. */
function align(points: number[], guides: number[], tol: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null
  for (const p of points) {
    const g = near(p, guides, tol)
    if (g !== null && (!best || Math.abs(g - p) < Math.abs(best.delta))) best = { delta: g - p, at: g }
  }
  return best
}

/** A box moved: its left/centre/right and top/middle/bottom snap to guides, else to whole percents. */
export function snapMove(box: Box, guides: Guides, tol: number): Snapped {
  const ax = align([box.left, box.left + box.width / 2, box.left + box.width], guides.x, tol)
  const ay = align([box.top, box.top + box.height / 2, box.top + box.height], guides.y, tol)
  return {
    box: { ...box, left: ax ? box.left + ax.delta : round(box.left), top: ay ? box.top + ay.delta : round(box.top) },
    lines: { x: ax ? [ax.at] : [], y: ay ? [ay.at] : [] },
  }
}

/** A box resized from a handle: only the edges that handle moves snap; it never gets smaller than 2%. */
export function snapResize(box: Box, handle: Handle, guides: Guides, tol: number): Snapped {
  let { left, top, width, height } = box
  const lines: Snapped['lines'] = { x: [], y: [] }
  const edge = (v: number, list: number[], out: number[]) => {
    const g = near(v, list, tol)
    if (g === null) return round(v)
    out.push(g)
    return g
  }
  if (handle.includes('e')) width = Math.max(MIN, edge(left + width, guides.x, lines.x) - left)
  if (handle.includes('w')) {
    const right = left + width
    left = Math.min(right - MIN, edge(left, guides.x, lines.x))
    width = right - left
  }
  if (handle.includes('s')) height = Math.max(MIN, edge(top + height, guides.y, lines.y) - top)
  if (handle.includes('n')) {
    const bottom = top + height
    top = Math.min(bottom - MIN, edge(top, guides.y, lines.y))
    height = bottom - top
  }
  return { box: { left, top, width, height }, lines }
}
