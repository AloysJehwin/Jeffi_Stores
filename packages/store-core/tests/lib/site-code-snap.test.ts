import { describe, it, expect } from 'vitest'
import { guidesFor, snapMove, snapResize } from '@/lib/site/code/snap'

// Free layers' handles snap in % of the frame: to its edges, centre and fractions, to the other boxes' edges and
// centres, else to whole percents.

const box = { left: 10.4, top: 20.2, width: 30, height: 10 }

describe('free layer snapping', () => {
  it('moves onto the frame centre or a neighbour, else to whole percents', () => {
    const g = guidesFor([{ left: 60, top: 0, width: 20, height: 40 }])
    // The centre (10.4 + 15 = 25.4) is near the 25% fraction.
    expect(snapMove(box, g, 1).box.left).toBeCloseTo(10)
    expect(snapMove(box, g, 1).lines.x).toEqual([25])
    // The right edge lands on the neighbour's left edge.
    expect(snapMove({ ...box, left: 29.5 }, g, 1)).toMatchObject({ box: { left: 30 }, lines: { x: [60] } })
    // Nothing near: whole percents, no lines.
    expect(snapMove({ ...box, left: 41.6, top: 61.7 }, guidesFor([]), 0.5)).toEqual({ box: { ...box, left: 42, top: 62 }, lines: { x: [], y: [] } })
  })

  it('resizes only the edges its handle moves, never below 2%', () => {
    const g = guidesFor([])
    expect(snapResize({ ...box, width: 39.4 }, 'e', g, 1)).toMatchObject({ box: { left: 10.4, width: 50 - 10.4 }, lines: { x: [50] } })
    const w = snapResize({ left: 24.6, top: 10, width: 20, height: 10 }, 'w', g, 1)
    expect(w.box.left).toBe(25)
    expect(w.box.left + w.box.width).toBeCloseTo(44.6)
    expect(snapResize({ left: 10, top: 10, width: 20, height: 10 }, 'se', g, 0.1).box).toEqual({ left: 10, top: 10, width: 20, height: 10 })
    expect(snapResize({ left: 10, top: 10, width: 0.5, height: 10 }, 'e', g, 0.1).box.width).toBe(2)
    expect(snapResize({ left: 10, top: 48.7, width: 20, height: 10 }, 'n', g, 2).box.top).toBe(50)
  })
})
