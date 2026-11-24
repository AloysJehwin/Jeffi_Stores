import { describe, it, expect } from 'vitest'
import type { CodeNode } from '@jeffi/site-blocks'
import { applyOps } from '@jeffi/site-blocks/design'
import { canFree, layerAt, layersAt, litClass, placeOps, restackOps, unplaceOps } from '@/components/site-editor/free-ops'

// Free layers as operations on a section's tree: the element placed and its frame readied, back into the flow, and
// restacked among the section's layers.

const lit = (v: string) => ({ k: 'lit' as const, v })
const tree: CodeNode = {
  t: 'el',
  tag: 'section',
  props: { className: lit('py-16') },
  id: 'e1',
  children: [
    { t: 'el', tag: 'h2', props: { className: lit('text-3xl') }, id: 'e2', children: [{ t: 'text', value: 'Hi', id: 'e2.0' }] },
    { t: 'cmp', name: 'Image', props: {}, id: 'e3', children: [] },
    { t: 'cmp', name: 'Products', props: {}, id: 'e4', children: [], render: { param: 'p', body: { t: 'el', tag: 'div', props: {}, id: 'e5', children: [] } } },
    { t: 'el', tag: 'p', props: { className: { k: 'tpl', parts: ['a ', { k: 'path', root: 'x', path: [] }] } }, id: 'e6', ro: true, children: [] },
  ],
}
const cls = (t: CodeNode, id: string) => litClass(t, id)

describe('free layer operations', () => {
  it('tells which elements may be placed freely', () => {
    expect(canFree(tree, 'e2')).toBe(true)
    expect(canFree(tree, 'e3')).toBe(true)
    expect(canFree(tree, 'e1')).toBe(false)
    expect(canFree(tree, 'e5')).toBe(false)
    expect(canFree(tree, 'e6')).toBe(false)
  })

  it('places an element, readies its frame, and stacks new layers on top', () => {
    const one = applyOps(tree, placeOps(tree, 'e2', 'lg', { left: 10, top: 20, width: 50 }, { frame: 'e1', frameHeight: 480 })).tree
    expect(cls(one, 'e2')).toBe('text-3xl lg:absolute lg:left-[10%] lg:top-[20%] lg:w-[50%] lg:z-10')
    expect(cls(one, 'e1')).toBe('py-16 relative lg:min-h-[480px]')
    const two = applyOps(one, placeOps(one, 'e3', 'lg', { left: 60, top: 0, width: 30, height: 40 })).tree
    expect(layerAt(two, 'e3', 'lg')).toMatchObject({ z: 20, rect: { height: 40 } })
    expect(layersAt(two, 'lg').map(l => l.id)).toEqual(['e2', 'e3'])
    expect(layersAt(two, 'md')).toEqual([])
    // e2 to the front, then back into the flow.
    const front = applyOps(two, restackOps(two, 'e2', 'lg', 'front')).tree
    expect(layerAt(front, 'e2', 'lg')?.z).toBe(30)
    expect(restackOps(front, 'e2', 'lg', 'front')).toEqual([])
    const back = applyOps(front, unplaceOps(front, 'e2', 'lg')).tree
    expect(cls(back, 'e2')).toBe('text-3xl')
    expect(placeOps(tree, 'e6', 'lg', { left: 0, top: 0, width: 10 })).toEqual([])
  })
})

describe('the phone fallback', () => {
  it('says where a layer leaves the flow when it is placed only on wider screens', async () => {
    const { placedWider } = await import('@/components/site-editor/free-ops')
    const desk = applyOps(tree, placeOps(tree, 'e2', 'lg', { left: 10, top: 20, width: 50 })).tree
    expect(placedWider(desk, 'e2', 'base')).toBe('lg')
    expect(placedWider(desk, 'e2', 'md')).toBe('lg')
    expect(placedWider(desk, 'e2', 'lg')).toBeNull()
    const both = applyOps(desk, placeOps(desk, 'e2', 'base', { left: 0, top: 0, width: 100 })).tree
    expect(placedWider(both, 'e2', 'base')).toBeNull()
    expect(placedWider(both, 'e2', 'md')).toBe('lg')
    expect(layerAt(both, 'e2', 'md')).toBeNull()
  })
})
