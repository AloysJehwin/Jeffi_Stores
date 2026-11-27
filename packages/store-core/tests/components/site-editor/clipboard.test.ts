import { describe, it, expect, beforeEach } from 'vitest'
import type { CodeNode } from '@jeffi/site-blocks'
import { applyOps, findNode, treeIds } from '@jeffi/site-blocks/design'
import { clearClip, copyNodes, looseRoots, pasteOps, readClip, writeClip } from '@/components/site-editor/clipboard'
import { layerAt, litClass } from '@/components/site-editor/free-ops'
import { placeFree } from '@/lib/site/code/free'

// Copy and paste across sections: copies come in under fresh ids, a pasted free layer keeps its placement, and parts
// the target can't hold are refused with a reason.

const lit = (v: string) => ({ k: 'lit' as const, v })
const text = (id: string, value: string): CodeNode => ({ t: 'text', value, id })
const el = (id: string, tag: string, className: string, children: CodeNode[] = []): CodeNode => ({ t: 'el', tag, props: className ? { className: lit(className) } : {}, id, children })

const source: CodeNode = el('e1', 'section', 'relative py-16', [
  el('e2', 'h2', placeFree('', 'lg', { left: 10, top: 20, width: 40 }), [text('e2.0', 'Hello')]),
  el('e3', 'div', 'flex', [el('e4', 'p', '', [text('e4.0', 'Words')])]),
  { t: 'cmp', name: 'Products', props: {}, id: 'e5', children: [], render: { param: 'p', body: el('e6', 'div', '', [{ t: 'expr', value: { k: 'path', root: 'p', path: ['name'] }, id: 'e6.0' }]) } },
  { t: 'cmp', name: 'Checkout', props: {}, id: 'e7', locked: true, children: [] },
])
const target: CodeNode = el('e1', 'section', 'py-16', [el('e2', 'p', '', [text('e2.0', 'Here')]), el('e3', 'div', '', [])])

beforeEach(() => {
  clearClip()
  sessionStorage.clear()
})

describe('clipboard storage', () => {
  it('keeps nodes in memory and mirrors them to sessionStorage', () => {
    expect(readClip()).toBeNull()
    writeClip([source])
    expect(readClip()).toEqual([source])
    expect(readClip()).not.toBe(source)
    expect(JSON.parse(sessionStorage.getItem('site-editor:clipboard')!)).toHaveLength(1)
  })

  it('reads the mirror after the memory is gone (a reload)', () => {
    sessionStorage.setItem('site-editor:clipboard', JSON.stringify([source.t === 'el' ? source.children[1] : null]))
    expect(readClip()?.[0].id).toBe('e3')
    sessionStorage.setItem('site-editor:clipboard', 'not json')
    clearClip()
    sessionStorage.setItem('site-editor:clipboard', 'not json')
    expect(readClip()).toBeNull()
  })
})

describe('copy', () => {
  it('takes the nodes in tree order and drops one inside another selected', () => {
    const r = copyNodes(source, ['e4', 'e3', 'e2'])
    expect('nodes' in r && r.nodes.map(n => n.id)).toEqual(['e2', 'e3'])
  })
  it('refuses the section and parts the page has once', () => {
    expect(copyNodes(source, ['e1'])).toHaveProperty('error')
    expect(copyNodes(source, ['e7'])).toHaveProperty('error')
    expect(copyNodes(source, [])).toHaveProperty('error')
  })
})

describe('paste', () => {
  it('inserts copies under fresh ids, every descendant renewed, after the selection', () => {
    const copy = copyNodes(source, ['e3'])
    const r = pasteOps(target, 'nodes' in copy ? copy.nodes : [], 'e2')
    expect('ops' in r).toBe(true)
    if (!('ops' in r)) return
    const next = applyOps(target, r.ops).tree
    expect(r.ids).toEqual(['e4'])
    expect(treeIds(next).filter((x, i, a) => a.indexOf(x) !== i)).toEqual([])
    const pasted = findNode(next, 'e4')!.node
    expect(pasted.t === 'el' && pasted.children[0].id).toBe('e5')
    expect(findNode(next, 'e5')?.node.t === 'el' && findNode(next, 'e5')!.node).toBeTruthy()
    expect(next.t === 'el' && next.children.map(c => c.id)).toEqual(['e2', 'e4', 'e3'])
    // The target's own ids are untouched.
    expect(findNode(next, 'e3')!.node.t === 'el' && (findNode(next, 'e3')!.node as { children: unknown[] }).children).toHaveLength(0)
  })

  it('goes inside the selected box, and at the end of the section with nothing selected', () => {
    const copy = copyNodes(source, ['e4'])
    const nodes = 'nodes' in copy ? copy.nodes : []
    const inside = pasteOps(target, nodes, 'e3')
    expect('ops' in inside && inside.ops[0]).toMatchObject({ op: 'insert', parent: 'e3', index: 0 })
    const end = pasteOps(target, nodes, null)
    expect('ops' in end && end.ops[0]).toMatchObject({ op: 'insert', parent: 'e1', index: 2 })
  })

  it('keeps a free layer’s placement and readies the frame', () => {
    const copy = copyNodes(source, ['e2'])
    const bare: CodeNode = el('e1', 'section', 'py-16', [el('e2', 'p', '', [])])
    const r = pasteOps(bare, 'nodes' in copy ? copy.nodes : [], 'e2')
    if (!('ops' in r)) throw new Error('refused')
    const next = applyOps(bare, r.ops).tree
    expect(layerAt(next, r.ids[0], 'lg')).toMatchObject({ rect: { left: 10, top: 20, width: 40 } })
    expect(litClass(next, 'e1')).toContain('relative')
  })

  it('refuses parts the page has once and data read outside its list', () => {
    expect(pasteOps(target, [source.t === 'el' ? source.children[3] : source], 'e2')).toEqual({ error: 'This part can only appear once on the page' })
    const inner = source.t === 'el' && source.children[2].t === 'cmp' ? source.children[2].render!.body : source
    expect(looseRoots(inner)).toEqual(new Set(['p']))
    expect(pasteOps(target, [inner], 'e2')).toHaveProperty('error')
    expect(pasteOps(target, [], 'e2')).toEqual({ error: 'Nothing copied yet' })
  })

  it('allows data-reading parts inside a list that binds the same name', () => {
    const list = source.t === 'el' ? source.children[2] : source
    const inner = list.t === 'cmp' ? list.render!.body : list
    const copy = pasteOps(source, [inner], 'e6')
    expect('ops' in copy).toBe(true)
  })
})
