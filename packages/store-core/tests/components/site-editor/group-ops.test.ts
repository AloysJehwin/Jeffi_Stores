import { describe, it, expect } from 'vitest'
import type { CodeNode } from '@jeffi/site-blocks'
import { applyOps, findNode, treeIds } from '@jeffi/site-blocks/design'
import { placeFree, setRotate } from '@/lib/site/code/free'
import { arrangeOps, layerAt, litClass, rotateOps, shiftOps } from '@/components/site-editor/free-ops'
import { canUngroup, groupOps, groupable, ungroupOps } from '@/components/site-editor/group-ops'
import { isGroup, nodeName } from '@/components/site-editor/nodes'

// Group and ungroup, composed from wrap and unwrap plus placement classes; ids stay put and one undo restores the tree.

const lit = (v: string) => ({ k: 'lit' as const, v })
const el = (id: string, className: string, children: CodeNode[] = []): CodeNode => ({ t: 'el', tag: 'div', props: { className: lit(className) }, id, children })
const tree: CodeNode = el('e1', 'relative py-16', [
  el('e2', placeFree('', 'lg', { left: 10, top: 10, width: 20 })),
  el('e3', placeFree('', 'lg', { left: 40, top: 30, width: 20, height: 20 })),
  el('e4', 'p-2'),
  el('e5', 'p-4', [el('e6', 'p-1')]),
])
const boxes = new Map([
  ['e2', { left: 10, top: 10, width: 20, height: 10 }],
  ['e3', { left: 40, top: 30, width: 20, height: 20 }],
])

describe('group', () => {
  it('needs siblings that sit next to each other', () => {
    expect(groupable(tree, ['e2', 'e3'])).toEqual({ ids: ['e2', 'e3'] })
    expect(groupable(tree, ['e3', 'e2'])).toEqual({ ids: ['e2', 'e3'] })
    expect(groupable(tree, ['e2'])).toHaveProperty('error')
    expect(groupable(tree, ['e2', 'e4'])).toHaveProperty('error')
    expect(groupable(tree, ['e2', 'e6'])).toHaveProperty('error')
    expect(groupable(tree, ['e1', 'e2'])).toHaveProperty('error')
  })

  it('makes free layers one free layer over their union, each member in % of it, ids stable', () => {
    const ops = groupOps(tree, ['e2', 'e3'], 'lg', boxes)
    expect(Array.isArray(ops)).toBe(true)
    const r = applyOps(tree, ops as never[])
    const g = findNode(r.tree, 'e7')!.node
    expect(isGroup(g)).toBe(true)
    expect(nodeName(g)).toBe('Group')
    expect(layerAt(r.tree, 'e7', 'lg')).toMatchObject({ rect: { left: 10, top: 10, width: 50, height: 40 }, z: 10 })
    expect(layerAt(r.tree, 'e2', 'lg')?.rect).toEqual({ left: 0, top: 0, width: 40 })
    expect(layerAt(r.tree, 'e3', 'lg')?.rect).toEqual({ left: 60, top: 50, width: 40, height: 50 })
    expect(treeIds(tree).every(id => treeIds(r.tree).includes(id))).toBe(true)
    // Undo restores the tree exactly.
    expect(applyOps(r.tree, r.inverse).tree).toEqual(tree)
  })

  it('wraps flow elements in a plain group', () => {
    const ops = groupOps(tree, ['e4', 'e5'], 'lg', null)
    const r = applyOps(tree, ops as never[])
    const g = findNode(r.tree, 'e7')!.node
    expect(g.t === 'el' && g.children.map(c => c.id)).toEqual(['e4', 'e5'])
    expect(litClass(r.tree, 'e7')).toBe('')
  })

  it('asks for measured boxes when all are free', () => {
    expect(groupOps(tree, ['e2', 'e3'], 'lg', null)).toHaveProperty('error')
  })
})

describe('ungroup', () => {
  const grouped = applyOps(tree, groupOps(tree, ['e2', 'e3'], 'lg', boxes) as never[]).tree

  it('puts the members back in % of the group’s frame', () => {
    expect(canUngroup(grouped, 'e7')).toBe(true)
    expect(canUngroup(grouped, 'e1')).toBe(false)
    const r = applyOps(grouped, ungroupOps(grouped, 'e7', 'lg', { left: 10, top: 10, width: 50, height: 40 }) as never[])
    expect(findNode(r.tree, 'e7')).toBeNull()
    expect(layerAt(r.tree, 'e2', 'lg')?.rect).toEqual({ left: 10, top: 10, width: 20 })
    expect(layerAt(r.tree, 'e3', 'lg')?.rect).toEqual({ left: 40, top: 30, width: 20, height: 20 })
    expect(applyOps(r.tree, r.inverse).tree).toEqual(grouped)
  })

  it('refuses a rotated group, and a free group that was not measured', () => {
    const turned = applyOps(grouped, rotateOps(grouped, 'e7', 'lg', 30)).tree
    expect(ungroupOps(turned, 'e7', 'lg', { left: 10, top: 10, width: 50, height: 40 })).toHaveProperty('error')
    expect(ungroupOps(grouped, 'e7', 'lg', null)).toHaveProperty('error')
  })

  it('unwraps a flow group without placing anything', () => {
    const flow = applyOps(tree, groupOps(tree, ['e4', 'e5'], 'lg', null) as never[]).tree
    const r = applyOps(flow, ungroupOps(flow, 'e7', 'lg', null) as never[])
    expect(r.tree).toEqual(tree)
  })
})

describe('rotate, arrange and shift operations', () => {
  it('rotates a free layer only', () => {
    const r = applyOps(tree, rotateOps(tree, 'e2', 'lg', 45)).tree
    expect(layerAt(r, 'e2', 'lg')?.rotate).toBe(45)
    expect(litClass(r, 'e2')).toContain('lg:rotate-[45deg]')
    expect(rotateOps(tree, 'e4', 'lg', 45)).toEqual([])
    expect(setRotate('', 'lg', 45)).toBe('lg:rotate-[45deg]')
  })

  it('moves layers to new places in one batch, keeping size', () => {
    const ops = arrangeOps(tree, 'lg', [{ id: 'e2', left: 0, top: 5 }, { id: 'e3', left: 0, top: 30 }, { id: 'e4', left: 1, top: 1 }])
    const r = applyOps(tree, ops).tree
    expect(layerAt(r, 'e2', 'lg')?.rect).toEqual({ left: 0, top: 5, width: 20 })
    expect(layerAt(r, 'e3', 'lg')?.rect).toEqual({ left: 0, top: 30, width: 20, height: 20 })
    expect(litClass(r, 'e4')).toBe('p-2')
  })

  it('nudges and resizes the selection', () => {
    const moved = applyOps(tree, shiftOps(tree, 'lg', ['e2', 'e3', 'e4'], 5, -1)).tree
    expect(layerAt(moved, 'e2', 'lg')?.rect).toEqual({ left: 15, top: 9, width: 20 })
    expect(layerAt(moved, 'e3', 'lg')?.rect.left).toBe(45)
    const sized = applyOps(tree, shiftOps(tree, 'lg', ['e2', 'e3'], 1, 1, true)).tree
    expect(layerAt(sized, 'e2', 'lg')?.rect).toEqual({ left: 10, top: 10, width: 21 })
    expect(layerAt(sized, 'e3', 'lg')?.rect).toEqual({ left: 40, top: 30, width: 21, height: 21 })
  })
})
