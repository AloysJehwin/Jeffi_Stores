// Align and distribute for free layers sharing a frame, in % of that frame (rects in, rects out). Pure: the editor
// measures the layers on the canvas, runs this, and turns the moved rects into placement operations (free-ops.ts).

export interface ArrangeRect {
  id: string
  left: number
  top: number
  width: number
  height: number
}
export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'x' | 'y'

/** The frame itself, which a lone layer aligns to. */
export const FRAME_BOUNDS = { left: 0, top: 0, width: 100, height: 100 }

/** One decimal, as the placement classes keep it. */
const r1 = (n: number) => Math.round(n * 10) / 10

/** The box around the rects. */
export function boundsOf(rects: Omit<ArrangeRect, 'id'>[]) {
  const left = Math.min(...rects.map(r => r.left))
  const top = Math.min(...rects.map(r => r.top))
  const right = Math.max(...rects.map(r => r.left + r.width))
  const bottom = Math.max(...rects.map(r => r.top + r.height))
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * The rects moved so their left, centre, right, top, middle or bottom edges line up: with the frame for one rect, with
 * the selection's bounds for several. Sizes never change.
 */
export function alignRects(rects: ArrangeRect[], kind: AlignKind): ArrangeRect[] {
  if (!rects.length) return []
  const to = rects.length === 1 ? FRAME_BOUNDS : boundsOf(rects)
  return rects.map(r => {
    switch (kind) {
      case 'left':
        return { ...r, left: r1(to.left) }
      case 'center':
        return { ...r, left: r1(to.left + (to.width - r.width) / 2) }
      case 'right':
        return { ...r, left: r1(to.left + to.width - r.width) }
      case 'top':
        return { ...r, top: r1(to.top) }
      case 'middle':
        return { ...r, top: r1(to.top + (to.height - r.height) / 2) }
      case 'bottom':
        return { ...r, top: r1(to.top + to.height - r.height) }
    }
  })
}

/**
 * Three or more rects spread so the gaps between them are equal, the outermost two staying where they are. Returned in
 * the order of the input.
 */
export function distributeRects(rects: ArrangeRect[], axis: DistributeAxis): ArrangeRect[] {
  if (rects.length < 3) return rects
  const pos = (r: ArrangeRect) => (axis === 'x' ? r.left : r.top)
  const size = (r: ArrangeRect) => (axis === 'x' ? r.width : r.height)
  const sorted = [...rects].sort((a, b) => pos(a) + size(a) / 2 - (pos(b) + size(b) / 2))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = pos(last) + size(last) - pos(first)
  const gap = (span - sorted.reduce((sum, r) => sum + size(r), 0)) / (sorted.length - 1)
  const at = new Map<string, number>()
  let cursor = pos(first)
  for (const r of sorted) {
    at.set(r.id, r1(cursor))
    cursor += size(r) + gap
  }
  return rects.map(r => (axis === 'x' ? { ...r, left: at.get(r.id)! } : { ...r, top: at.get(r.id)! }))
}

/** The rects that moved, as id and new left and top. */
export function movedRects(before: ArrangeRect[], after: ArrangeRect[]): { id: string; left: number; top: number }[] {
  const was = new Map(before.map(r => [r.id, r]))
  return after.filter(r => {
    const b = was.get(r.id)
    return b && (r1(b.left) !== r.left || r1(b.top) !== r.top)
  }).map(r => ({ id: r.id, left: r.left, top: r.top }))
}

/**
 * A group's box: the union of its members' rects (one decimal), and each member's rect in % of that box (width and
 * height scaled, a missing height kept missing). `members` carry their measured height in `box`.
 */
export function groupBox(members: { id: string; box: Omit<ArrangeRect, 'id'> }[]): { group: Omit<ArrangeRect, 'id'>; inside: ArrangeRect[] } {
  const raw = boundsOf(members.map(m => m.box))
  const group = { left: r1(raw.left), top: r1(raw.top), width: Math.max(2, r1(raw.width)), height: Math.max(2, r1(raw.height)) }
  const inside = members.map(m => ({
    id: m.id,
    left: r1(((m.box.left - group.left) / group.width) * 100),
    top: r1(((m.box.top - group.top) / group.height) * 100),
    width: r1((m.box.width / group.width) * 100),
    height: r1((m.box.height / group.height) * 100),
  }))
  return { group, inside }
}

/** The reverse: members' rects in % of a group's box, back in % of the group's frame. */
export function ungroupBox(group: Omit<ArrangeRect, 'id'>, inside: ArrangeRect[]): ArrangeRect[] {
  return inside.map(m => ({
    id: m.id,
    left: r1(group.left + (m.left * group.width) / 100),
    top: r1(group.top + (m.top * group.height) / 100),
    width: r1((m.width * group.width) / 100),
    height: r1((m.height * group.height) / 100),
  }))
}
