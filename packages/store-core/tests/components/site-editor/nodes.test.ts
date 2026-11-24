import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(async () => []), queryOne: vi.fn(async () => null), query: vi.fn(), withTransaction: vi.fn() }))

import type { CodeNode } from '@jeffi/site-blocks'
import { applyOp } from '@jeffi/site-blocks/design'
import { checkSection } from '@/lib/site/code/compile'
import { printSection } from '@/lib/site/code/print'
import { NEW_KINDS, hasLocked, insertPlace, litProp, newNode, newSectionTree, parentOf, pathTo } from '@/components/site-editor/nodes'

// The editor's element helpers, and the new elements and section it adds: each prints and compiles as the server
// will on save (compileSection(print(tree))).

const text = (id: string, value: string): CodeNode => ({ t: 'text', value, id })
const tree: CodeNode = {
  t: 'el',
  tag: 'section',
  props: {},
  id: 'e1',
  children: [
    { t: 'el', tag: 'h2', props: {}, id: 'e2', children: [text('e2.0', 'Hi')] },
    { t: 'cmp', name: 'Products', props: {}, id: 'e3', children: [], render: { param: 'p', body: { t: 'el', tag: 'div', props: {}, id: 'e4', children: [] } } },
    { t: 'cmp', name: 'AddToCart', props: {}, id: 'e5', children: [], locked: true },
  ],
}

describe('editor nodes', () => {
  it('places a new element after the selection, or at the end of the section or a slot body', () => {
    expect(insertPlace(tree, 'e2')).toEqual({ parent: 'e1', index: 1 })
    expect(insertPlace(tree, null)).toEqual({ parent: 'e1', index: 3 })
    expect(insertPlace(tree, 'e1')).toEqual({ parent: 'e1', index: 3 })
    expect(insertPlace(tree, 'e4')).toEqual({ parent: 'e4', index: 0 })
    expect(insertPlace(tree, 'nope')).toBeNull()
    expect(parentOf(tree, 'e3')).toMatchObject({ index: 1, parent: { id: 'e1' } })
    expect(parentOf(tree, 'e4')).toBeNull()
    expect(pathTo(tree, 'e4').map(n => n.id)).toEqual(['e1', 'e3', 'e4'])
  })

  it('finds parts the page needs and reads written-out props', () => {
    expect(hasLocked(tree)).toBe(true)
    expect(hasLocked((tree as { children: CodeNode[] }).children[0])).toBe(false)
    const link = newNode('button', 'e9')
    expect(litProp(link, 'href')).toBe('/products')
    expect(litProp(link, 'title')).toBe('')
    expect(litProp({ t: 'cmp', name: 'Image', props: { src: { k: 'path', root: 'p', path: ['image'] } }, children: [], id: 'x' }, 'src')).toBeNull()
  })

  it('adds elements and sections the compiler accepts', () => {
    const base = newSectionTree()
    expect(checkSection(printSection(base), { page: 'home', ids: true }).ok).toBe(true)
    for (const { kind } of NEW_KINDS) {
      const next = applyOp(base, { op: 'insert', parent: 'e2', index: 2, node: newNode(kind, 'e9') }).tree
      const r = checkSection(printSection(next), { page: 'home', ids: true })
      expect(r.ok, `${kind}: ${r.ok ? '' : r.issues.map(i => i.message).join('; ')}`).toBe(true)
      expect(JSON.stringify(r.ok && r.tree)).toContain('"id":"e9"')
    }
  })
})
