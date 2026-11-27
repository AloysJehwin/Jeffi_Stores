import { describe, it, expect } from 'vitest'
import type { CodeNode } from '@jeffi/site-blocks'
import { applyOps, treeIds } from '@jeffi/site-blocks/design'
import { layersAt, litClass } from '@/components/site-editor/free-ops'
import { makeSlideOps, rectFromBox, slideAspectOps, unslideOps } from '@/components/site-editor/slide-ops'
import { aspectOf, cqwOwn, isSlide } from '@/lib/site/code/slide'

// A normal section made a slide (layers placed where they were measured), another aspect, and back again.

const lit = (v: string | number) => ({ k: 'lit' as const, v })
const words = (tree: CodeNode): string[] => {
  const out: string[] = []
  const walk = (n: CodeNode) => {
    if (n.t === 'text') out.push(n.value)
    if (n.t === 'el' || n.t === 'cmp') n.children.forEach(walk)
  }
  walk(tree)
  return out
}
const tree: CodeNode = {
  t: 'el',
  tag: 'section',
  id: 'e1',
  props: { className: lit('py-16 bg-surface md:py-20') },
  children: [
    { t: 'el', tag: 'h1', id: 'e2', props: { className: lit('text-3xl md:text-5xl') }, children: [{ t: 'text', value: 'Hello', id: 'e2.0' }] },
    { t: 'el', tag: 'p', id: 'e3', props: { className: lit('text-base') }, children: [{ t: 'text', value: 'World', id: 'e3.0' }] },
    { t: 'cmp', name: 'Products', id: 'e4', props: { limit: lit(1) }, children: [] },
  ],
}
const cls = (t: CodeNode, id: string) => litClass(t, id) ?? ''

describe('slide operations', () => {
  it('converts a measured box to % of the frame it will have', () => {
    expect(rectFromBox(1000, '16:9', { x: 100, y: 56.25, width: 500, height: 100 }, false)).toEqual({ left: 10, top: 10, width: 50 })
    expect(rectFromBox(1000, '16:9', { x: 900, y: 0, width: 500, height: 100 }, true)).toMatchObject({ left: 50, width: 50 })
  })

  it('makes a slide: frame classes, layers at md and lg, words in cqw, a live part clipped with a height', () => {
    const ops = makeSlideOps(tree, {
      lg: { width: 1280, height: 800, layers: { e2: { x: 128, y: 72, width: 640, height: 120, fontPx: 64 }, e4: { x: 800, y: 72, width: 400, height: 400 } } },
      md: { width: 768, height: 600, layers: { e2: { x: 77, y: 43, width: 384, height: 90, fontPx: 38 } } },
    })
    const made = applyOps(tree, ops).tree
    expect(isSlide(made)).toBe(true)
    expect(aspectOf(made)).toBe('16:9')
    expect(layersAt(made, 'lg').map(l => l.id)).toEqual(['e2', 'e3', 'e4'])
    expect(layersAt(made, 'md').map(l => l.id)).toEqual(['e2', 'e3', 'e4'])
    expect(layersAt(made, 'base')).toEqual([])
    expect(layersAt(made, 'lg')[0].layer.rect).toMatchObject({ left: 10, width: 50 })
    expect(cqwOwn(cls(made, 'e2'), 'lg')).toBe(5)
    expect(cls(made, 'e4')).toContain('md:overflow-hidden')
    expect(layersAt(made, 'lg')[2].layer.rect.height).toBeDefined()
    // A layer nothing was measured for takes a place down the frame.
    expect(layersAt(made, 'lg')[1].layer.rect.width).toBe(88)
    expect(makeSlideOps(made)).toEqual([])
  })

  it('changes the aspect, and goes back to a flow section keeping ids and words', () => {
    const made = applyOps(tree, makeSlideOps(tree, { lg: { width: 1280, height: 800, layers: { e2: { x: 128, y: 72, width: 640, height: 120, fontPx: 64 } } } })).tree
    expect(slideAspectOps(made, '16:9')).toEqual([])
    const wide = applyOps(made, slideAspectOps(made, '21:9')).tree
    expect(aspectOf(wide)).toBe('21:9')
    const back = applyOps(wide, unslideOps(wide)).tree
    expect(isSlide(back)).toBe(false)
    expect(treeIds(back)).toEqual(treeIds(tree))
    expect(words(back)).toEqual(words(tree))
    expect(layersAt(back, 'lg')).toEqual([])
    expect(layersAt(back, 'md')).toEqual([])
    expect(cls(back, 'e2')).not.toContain('cqw')
    expect(cls(back, 'e1')).not.toContain('aspect')
    expect(unslideOps(back)).toEqual([])
  })
})
