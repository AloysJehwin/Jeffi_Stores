import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))

import { readClasses } from '@/lib/site/code/classes'
import { compileSection } from '@/lib/site/code/compile'
import { frameFor, freeAt, pct, placeFree, placedHere, restack, unplaceFree, zValue } from '@/lib/site/code/free'

// Free layers as classes: placed in % of the frame per breakpoint, in the flow below where they are placed, and
// compiled to CSS like any other class.

const has = (cls: string, ...tokens: string[]) => tokens.every(t => cls.split(' ').includes(t))

describe('free layers', () => {
  it('places an element at a breakpoint and leaves the narrower ones in the flow', () => {
    const cls = placeFree('p-4 w-full', 'lg', { left: 12, top: 30, width: 40 })
    expect(has(cls, 'p-4', 'w-full', 'lg:absolute', 'lg:left-[12%]', 'lg:top-[30%]', 'lg:w-[40%]', 'lg:z-10')).toBe(true)
    expect(freeAt(cls, 'lg')).toEqual({ from: 'lg', rect: { left: 12, top: 30, width: 40 }, z: 10 })
    expect(freeAt(cls, 'md')).toBeNull()
    expect(freeAt(cls, 'base')).toBeNull()
    expect(placedHere(cls, 'lg')).toBe(true)
  })

  it('placed on Tablet, leaves Desktop as it was until Desktop is placed too', () => {
    const cls = placeFree('', 'md', { left: 5, top: 10, width: 50, height: 25 })
    expect(freeAt(cls, 'md')).toMatchObject({ from: 'md', rect: { height: 25 } })
    expect(freeAt(cls, 'lg')).toBeNull()
    expect(has(cls, 'lg:static', 'lg:w-auto', 'lg:h-auto')).toBe(true)
    const own = placeFree(cls, 'lg', { left: 60, top: 10, width: 30 })
    expect(freeAt(own, 'lg')?.rect).toEqual({ left: 60, top: 10, width: 30 })
    expect(freeAt(own, 'md')?.rect.left).toBe(5)
  })

  it('placed on Phone, keeps Tablet in the flow as it was and Desktop as placed', () => {
    const desktop = placeFree('w-full', 'lg', { left: 10, top: 5, width: 50 })
    const both = placeFree(desktop, 'base', { left: 0, top: 0, width: 100 })
    expect(freeAt(both, 'base')?.rect.width).toBe(100)
    expect(freeAt(both, 'md')).toBeNull()
    expect(has(both, 'md:static', 'md:w-full')).toBe(true)
    expect(freeAt(both, 'lg')?.rect.left).toBe(10)
  })

  it('puts an element back in the flow, keeping widths the author gave', () => {
    const cls = placeFree('md:w-1/2', 'lg', { left: 10, top: 10, width: 30 })
    const back = unplaceFree(cls, 'lg')
    expect(freeAt(back, 'lg')).toBeNull()
    expect(back).toBe('md:w-1/2')
    // Placed on Phone alone: Tablet and Desktop stay in the flow.
    const phone = placeFree('', 'base', { left: 0, top: 0, width: 80 })
    expect(has(phone, 'md:static', 'md:w-auto')).toBe(true)
    expect(freeAt(phone, 'lg')).toBeNull()
    // A Phone placement carrying up, taken off Desktop: Desktop sits in the flow explicitly.
    const off = unplaceFree('absolute left-[0%] top-[0%] w-[80%]', 'lg')
    expect(freeAt(off, 'lg')).toBeNull()
    expect(has(off, 'lg:static', 'lg:w-auto')).toBe(true)
    expect(freeAt(off, 'base')).not.toBeNull()
  })

  it('makes the frame relative and keeps its height once a layer leaves the flow', () => {
    const frame = frameFor('py-16', 'lg', 640.4)
    expect(readClasses(frame).values.base.position).toBe('relative')
    expect(readClasses(frame).values.lg.minHeight).toBe('[640px]')
    expect(frameFor('relative min-h-screen', 'lg', 640)).toBe('relative min-h-screen')
    expect(frameFor('lg:absolute', 'lg', null)).toBe('lg:absolute')
  })

  it('restacks layers and writes percentages and z values as classes', () => {
    expect(restack([10, 20, 30], 20, 'front')).toBe(40)
    expect(restack([10, 20, 30], 20, 'back')).toBe(0)
    expect(restack([10, 20, 30], 20, 'forward')).toBe(31)
    expect(restack([10, 20, 30], 20, 'backward')).toBe(9)
    expect(restack([10], 10, 'forward')).toBe(10)
    expect([pct(12.345), pct(-3), pct(500)]).toEqual(['[12.3%]', '[-3%]', '[200%]'])
    expect([zValue(20), zValue(11)]).toEqual(['20', '[11]'])
  })

  it('compiles placed layers to CSS like any other class', async () => {
    const layer = placeFree('rounded-xl', 'lg', { left: 12.5, top: 30, width: 40, height: 50 }, 11)
    const frame = frameFor('py-16', 'lg', 640)
    const r = await compileSection(`export default function Section() {\n  return (\n    <section className="${frame}"><div className="${layer}">Hi</div></section>\n  )\n}\n`, { page: 'home' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const decl of ['position: absolute', 'left: 12.5%', 'top: 30%', 'width: 40%', 'height: 50%', 'z-index: 11', 'min-height: 640px', 'position: relative']) expect(r.section.css).toContain(decl)
  })
})
