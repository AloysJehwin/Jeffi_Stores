import { describe, it, expect } from 'vitest'
import type { CodeNode } from '@jeffi/site-blocks'
import { applyOp } from '@jeffi/site-blocks/design'
import { moveIndex } from '@/components/site-editor/Layers'

// A layers drag (dnd-kit's over row) as design.ts's move index, counted in the full child list words included.
const el = (id: string): CodeNode => ({ t: 'el', tag: 'p', props: {}, children: [], id })
const kids: CodeNode[] = [el('a'), { t: 'text', value: ' ', id: 'r.1' }, el('b'), el('c')]
const root: CodeNode = { t: 'el', tag: 'div', props: {}, children: kids, id: 'r' }
const order = (t: CodeNode) => (t.t === 'el' ? t.children.map(c => c.id) : [])

describe('layers reorder', () => {
  it('moves down past the row dropped on, and up before it', () => {
    const down = moveIndex(kids, 'a', 'c')!
    expect(order(applyOp(root, { op: 'move', id: 'a', parent: 'r', index: down }).tree)).toEqual(['r.1', 'b', 'c', 'a'])
    const up = moveIndex(kids, 'c', 'a')!
    expect(order(applyOp(root, { op: 'move', id: 'c', parent: 'r', index: up }).tree)).toEqual(['c', 'a', 'r.1', 'b'])
    expect(moveIndex(kids, 'a', 'a')).toBeNull()
    expect(moveIndex(kids, 'a', 'zz')).toBeNull()
  })
})
