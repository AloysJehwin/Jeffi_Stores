import { describe, it, expect } from 'vitest'
import { readClasses } from '@/lib/site/code/classes'
import { clampDeg, freeAt, placeFree, rotateAt, setRotate, unplaceFree } from '@/lib/site/code/free'
import { safeClass } from '@/lib/site/code/allow'

// Rotation is a per-breakpoint `rotate-[Ndeg]` class on a free layer, whole degrees in -180..180.

describe('rotation classes', () => {
  it('writes and reads whole degrees per breakpoint', () => {
    const cls = setRotate('p-2', 'lg', 15)
    expect(cls).toBe('p-2 lg:rotate-[15deg]')
    expect(rotateAt(cls, 'lg')).toBe(15)
    expect(rotateAt(cls, 'md')).toBe(0)
    expect(setRotate(cls, 'lg', -30)).toBe('p-2 lg:rotate-[-30deg]')
    expect(rotateAt(setRotate(cls, 'lg', -30), 'lg')).toBe(-30)
    expect(setRotate(cls, 'lg', 0)).toBe('p-2')
    expect(readClasses('rotate-[12deg]').values.base.rotate).toBe('[12deg]')
  })

  it('reads Tailwind’s own steps and negative forms', () => {
    expect(rotateAt('rotate-12', 'base')).toBe(12)
    expect(rotateAt('-rotate-6', 'base')).toBe(-6)
    expect(rotateAt('-rotate-[20deg]', 'lg')).toBe(-20)
    expect(rotateAt('md:rotate-45', 'lg')).toBe(45)
  })

  it('keeps wider breakpoints as they were when a narrower one turns', () => {
    const cls = setRotate('md:rotate-[10deg]', 'base', 5)
    expect(rotateAt(cls, 'base')).toBe(5)
    expect(rotateAt(cls, 'md')).toBe(10)
  })

  it('clamps to -180..180', () => {
    expect(clampDeg(190)).toBe(-170)
    expect(clampDeg(180)).toBe(180)
    expect(clampDeg(-180)).toBe(-180)
    expect(clampDeg(12.4)).toBe(12)
    expect(rotateAt(setRotate('', 'lg', 270), 'lg')).toBe(-90)
  })

  it('shows on a placed layer, goes when it returns to the flow, and passes the class allowlist', () => {
    const placed = setRotate(placeFree('', 'lg', { left: 10, top: 10, width: 30 }), 'lg', 15)
    expect(freeAt(placed, 'lg')).toMatchObject({ rotate: 15 })
    expect(freeAt(placeFree('', 'lg', { left: 10, top: 10, width: 30 }), 'lg')?.rotate).toBeUndefined()
    expect(unplaceFree(placed, 'lg')).toBe('')
    expect(['lg:rotate-[15deg]', 'lg:rotate-[-15deg]', '-rotate-[15deg]'].every(safeClass)).toBe(true)
  })
})
