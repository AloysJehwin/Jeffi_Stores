import { describe, it, expect } from 'vitest'
import { alignRects, boundsOf, distributeRects, groupBox, movedRects, ungroupBox, type ArrangeRect } from '@/lib/site/code/arrange'

// Align and distribute free layers in % of their frame: rects in, rects out.

const r = (id: string, left: number, top: number, width: number, height: number): ArrangeRect => ({ id, left, top, width, height })
const by = (list: ArrangeRect[], id: string) => list.find(x => x.id === id)!

describe('align', () => {
  const list = [r('a', 10, 10, 20, 10), r('b', 40, 30, 30, 20), r('c', 60, 70, 10, 10)]

  it('lines several layers up with the selection’s bounds', () => {
    expect(boundsOf(list)).toEqual({ left: 10, top: 10, width: 60, height: 70 })
    expect(alignRects(list, 'left').map(x => x.left)).toEqual([10, 10, 10])
    expect(alignRects(list, 'right').map(x => x.left)).toEqual([50, 40, 60])
    expect(alignRects(list, 'center').map(x => x.left)).toEqual([30, 25, 35])
    expect(alignRects(list, 'top').map(x => x.top)).toEqual([10, 10, 10])
    expect(alignRects(list, 'bottom').map(x => x.top)).toEqual([70, 60, 70])
    expect(alignRects(list, 'middle').map(x => x.top)).toEqual([40, 35, 40])
  })

  it('aligns a lone layer with its frame and never resizes', () => {
    const one = [r('a', 10, 10, 20, 10)]
    expect(alignRects(one, 'right')[0]).toEqual(r('a', 80, 10, 20, 10))
    expect(alignRects(one, 'center')[0].left).toBe(40)
    expect(alignRects(one, 'bottom')[0]).toEqual(r('a', 10, 90, 20, 10))
    expect(alignRects([], 'left')).toEqual([])
  })
})

describe('distribute', () => {
  it('spreads three or more layers with equal gaps, the outer two staying put', () => {
    const list = [r('c', 80, 0, 20, 10), r('a', 0, 0, 10, 10), r('b', 15, 0, 30, 10)]
    const out = distributeRects(list, 'x')
    expect(out.map(x => x.id)).toEqual(['c', 'a', 'b'])
    expect(by(out, 'a').left).toBe(0)
    expect(by(out, 'c').left).toBe(80)
    // 100 wide in all, 60 of it layers: two gaps of 20.
    expect(by(out, 'b').left).toBe(30)
    const down = distributeRects([r('a', 0, 0, 10, 10), r('b', 0, 12, 10, 20), r('c', 0, 70, 10, 30)], 'y')
    expect(by(down, 'b').top).toBe(30)
    expect(distributeRects(list.slice(0, 2), 'x')).toEqual(list.slice(0, 2))
  })

  it('reports only what moved', () => {
    const before = [r('a', 0, 0, 10, 10), r('b', 15, 0, 30, 10), r('c', 80, 0, 20, 10)]
    expect(movedRects(before, distributeRects(before, 'x'))).toEqual([{ id: 'b', left: 30, top: 0 }])
    expect(movedRects(before, before)).toEqual([])
  })
})

describe('group boxes', () => {
  it('puts members in % of the union, and back', () => {
    const members = [
      { id: 'a', box: { left: 10, top: 20, width: 20, height: 10 } },
      { id: 'b', box: { left: 40, top: 40, width: 20, height: 20 } },
    ]
    const { group, inside } = groupBox(members)
    expect(group).toEqual({ left: 10, top: 20, width: 50, height: 40 })
    expect(by(inside, 'a')).toEqual(r('a', 0, 0, 40, 25))
    expect(by(inside, 'b')).toEqual(r('b', 60, 50, 40, 50))
    const back = ungroupBox(group, inside)
    expect(by(back, 'a')).toEqual(r('a', 10, 20, 20, 10))
    expect(by(back, 'b')).toEqual(r('b', 40, 40, 20, 20))
  })
})
