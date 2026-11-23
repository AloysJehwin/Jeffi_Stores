import { describe, it, expect } from 'vitest'
import {
  DOC_SCHEMA_VERSION,
  emptyDoc,
  normalizeDoc,
  topBlocks,
  insertBlock,
  removeBlock,
  blockPlace,
  updateBlock,
  moveBlock,
  reorder,
  blockVisible,
  cloneDoc,
  type Block,
  type PageDoc,
} from '@jeffi/site-blocks'

const block = (id: string, over: Partial<Block> = {}): Block => ({
  id,
  type: 'text',
  v: 1,
  props: {},
  ...over,
})

describe('emptyDoc', () => {
  it('is a fresh empty doc at the current schema version', () => {
    expect(emptyDoc()).toEqual({ schemaVersion: DOC_SCHEMA_VERSION, blocks: {}, order: [] })
  })
})

describe('normalizeDoc', () => {
  it('returns an empty doc for null/undefined/garbage', () => {
    expect(normalizeDoc(null)).toEqual({ schemaVersion: 1, blocks: {}, order: [] })
    expect(normalizeDoc(undefined)).toEqual({ schemaVersion: 1, blocks: {}, order: [] })
    expect(normalizeDoc({ blocks: 'nope' as any })).toEqual({ schemaVersion: 1, blocks: {}, order: [] })
  })

  it('drops blocks that are not objects or lack a string type', () => {
    const doc = normalizeDoc({
      blocks: {
        a: block('a'),
        bad1: null as any,
        bad2: 'x' as any,
        bad3: { id: 'bad3', v: 1, props: {} } as any, // no type
      },
      order: ['a', 'bad1', 'bad2', 'bad3'],
    })
    expect(Object.keys(doc.blocks)).toEqual(['a'])
    expect(doc.order).toEqual(['a'])
  })

  it('coerces v to a number (default 1) and props to an object', () => {
    const doc = normalizeDoc({
      blocks: {
        a: { id: 'x', type: 'text', v: '3' as any, props: { k: 1 } },
        b: { id: 'y', type: 'text', v: 0 as any, props: 'bad' as any },
      },
      order: ['a', 'b'],
    })
    expect(doc.blocks.a.v).toBe(3)
    expect(doc.blocks.a.id).toBe('a') // id forced to the key
    expect(doc.blocks.b.v).toBe(1) // 0 -> 1
    expect(doc.blocks.b.props).toEqual({})
  })

  it('drops order ids that point nowhere and de-dupes', () => {
    const doc = normalizeDoc({
      blocks: { a: block('a'), b: block('b') },
      order: ['a', 'ghost', 'a', 'b', 7 as any],
    })
    expect(doc.order).toEqual(['a', 'b'])
  })

  it('keeps reachable children and prunes dangling child ids and orphan blocks', () => {
    const doc = normalizeDoc({
      blocks: {
        root: block('root', { children: { main: ['child', 'ghost'] } }),
        child: block('child'),
        orphan: block('orphan'), // reachable by neither order nor a slot
      },
      order: ['root'],
    })
    expect(Object.keys(doc.blocks).sort()).toEqual(['child', 'root'])
    expect(doc.blocks.root.children).toEqual({ main: ['child'] })
    expect(doc.blocks.orphan).toBeUndefined()
  })

  it('normalizes a non-array child slot to empty', () => {
    const doc = normalizeDoc({
      blocks: { root: block('root', { children: { main: 'bad' as any } }) },
      order: ['root'],
    })
    expect(doc.blocks.root.children).toEqual({ main: [] })
  })

  it('carries settings through only when present', () => {
    expect(normalizeDoc({ blocks: {}, order: [], settings: { bg: 'x' } }).settings).toEqual({ bg: 'x' })
    expect('settings' in normalizeDoc({ blocks: {}, order: [] })).toBe(false)
  })
})

describe('topBlocks', () => {
  it('returns the ordered top-level blocks, skipping missing ids', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a'), b: block('b') }, order: ['b', 'ghost', 'a'] }
    expect(topBlocks(doc).map(b => b.id)).toEqual(['b', 'a'])
  })
})

describe('insertBlock', () => {
  const base: PageDoc = { schemaVersion: 1, blocks: { a: block('a') }, order: ['a'] }

  it('appends at the end by default', () => {
    const d = insertBlock(base, block('b'))
    expect(d.order).toEqual(['a', 'b'])
  })

  it('inserts at an index, clamping out-of-range', () => {
    expect(insertBlock(base, block('b'), 0).order).toEqual(['b', 'a'])
    expect(insertBlock(base, block('b'), -5).order).toEqual(['b', 'a'])
    expect(insertBlock(base, block('b'), 99).order).toEqual(['a', 'b'])
  })

  it('inserts into a parent slot and leaves order untouched', () => {
    const withParent: PageDoc = { schemaVersion: 1, blocks: { p: block('p') }, order: ['p'] }
    const d = insertBlock(withParent, block('c'), 0, { id: 'p', slot: 'main' })
    expect(d.blocks.p.children).toEqual({ main: ['c'] })
    expect(d.order).toEqual(['p'])
    expect(d.blocks.c).toBeDefined()
  })

  it('appends into an existing slot list', () => {
    const withParent: PageDoc = {
      schemaVersion: 1,
      blocks: { p: block('p', { children: { main: ['c1'] } }), c1: block('c1') },
      order: ['p'],
    }
    const d = insertBlock(withParent, block('c2'), 1, { id: 'p', slot: 'main' })
    expect(d.blocks.p.children).toEqual({ main: ['c1', 'c2'] })
  })

  it('throws when the parent does not exist', () => {
    expect(() => insertBlock(base, block('c'), 0, { id: 'missing', slot: 'main' })).toThrow(/No block missing/)
  })
})

describe('removeBlock', () => {
  it('removes a top-level block and its order entry', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a'), b: block('b') }, order: ['a', 'b'] }
    const d = removeBlock(doc, 'a')
    expect(d.blocks.a).toBeUndefined()
    expect(d.order).toEqual(['b'])
  })

  it('removes a block and all its descendants recursively', () => {
    const doc: PageDoc = {
      schemaVersion: 1,
      blocks: {
        root: block('root', { children: { main: ['mid'] } }),
        mid: block('mid', { children: { inner: ['leaf'] } }),
        leaf: block('leaf'),
        other: block('other'),
      },
      order: ['root', 'other'],
    }
    const d = removeBlock(doc, 'root')
    expect(Object.keys(d.blocks)).toEqual(['other'])
    expect(d.order).toEqual(['other'])
  })

  it('strips the removed id from a surviving parents slot', () => {
    const doc: PageDoc = {
      schemaVersion: 1,
      blocks: { p: block('p', { children: { main: ['c', 'keep'] } }), c: block('c'), keep: block('keep') },
      order: ['p'],
    }
    const d = removeBlock(doc, 'c')
    expect(d.blocks.p.children).toEqual({ main: ['keep'] })
    expect(d.blocks.c).toBeUndefined()
  })

  it('is a no-op for an unknown id', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a') }, order: ['a'] }
    expect(removeBlock(doc, 'ghost')).toEqual(doc)
  })
})

describe('blockPlace', () => {
  const doc: PageDoc = {
    schemaVersion: 1,
    blocks: { p: block('p', { children: { main: ['c0', 'c1'] } }), c0: block('c0'), c1: block('c1') },
    order: ['p'],
  }

  it('reports a top-level index', () => {
    expect(blockPlace(doc, 'p')).toEqual({ index: 0 })
  })
  it('reports the parent and slot index for a nested block', () => {
    expect(blockPlace(doc, 'c1')).toEqual({ parent: { id: 'p', slot: 'main' }, index: 1 })
  })
  it('returns null when the block is not on the page', () => {
    expect(blockPlace(doc, 'ghost')).toBeNull()
  })
})

describe('updateBlock', () => {
  const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a', { props: { x: 1 } }) }, order: ['a'] }

  it('shallow-merges the patch and keeps the id', () => {
    const d = updateBlock(doc, 'a', { props: { x: 2 }, v: 5 })
    expect(d.blocks.a).toEqual({ id: 'a', type: 'text', v: 5, props: { x: 2 } })
  })
  it('ignores an id in the patch', () => {
    const d = updateBlock(doc, 'a', { id: 'hacked' } as any)
    expect(d.blocks.a.id).toBe('a')
  })
  it('throws for an unknown id', () => {
    expect(() => updateBlock(doc, 'ghost', {})).toThrow(/No block ghost/)
  })
})

describe('moveBlock', () => {
  it('reorders a top-level block', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a'), b: block('b'), c: block('c') }, order: ['a', 'b', 'c'] }
    const d = moveBlock(doc, 'a', 2)
    expect(d.order).toEqual(['b', 'c', 'a'])
  })

  it('moves a block from top level into a parent slot', () => {
    const doc: PageDoc = {
      schemaVersion: 1,
      blocks: { p: block('p', { children: { main: [] } }), x: block('x') },
      order: ['p', 'x'],
    }
    const d = moveBlock(doc, 'x', 0, { id: 'p', slot: 'main' })
    expect(d.order).toEqual(['p'])
    expect(d.blocks.p.children).toEqual({ main: ['x'] })
  })

  it('moves a block out of one slot and into another, dropping the old reference', () => {
    const doc: PageDoc = {
      schemaVersion: 1,
      blocks: {
        p: block('p', { children: { left: ['x'], right: [] } }),
        x: block('x'),
      },
      order: ['p'],
    }
    const d = moveBlock(doc, 'x', 0, { id: 'p', slot: 'right' })
    expect(d.blocks.p.children).toEqual({ left: [], right: ['x'] })
  })

  it('throws when moving an unknown block', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a') }, order: ['a'] }
    expect(() => moveBlock(doc, 'ghost', 0)).toThrow(/No block ghost/)
  })

  it('refuses to move a block inside itself (its own descendant)', () => {
    const doc: PageDoc = {
      schemaVersion: 1,
      blocks: {
        root: block('root', { children: { main: ['child'] } }),
        child: block('child', { children: { inner: [] } }),
      },
      order: ['root'],
    }
    expect(() => moveBlock(doc, 'root', 0, { id: 'child', slot: 'inner' })).toThrow(/cannot go inside itself/)
  })
})

describe('reorder', () => {
  it('moves listed ids to the front, keeping unlisted ones after in their order', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a'), b: block('b'), c: block('c') }, order: ['a', 'b', 'c'] }
    const d = reorder(doc, ['c', 'a'])
    expect(d.order).toEqual(['c', 'a', 'b'])
  })
  it('ignores ids not in the current order', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a'), b: block('b') }, order: ['a', 'b'] }
    const d = reorder(doc, ['ghost', 'b'])
    expect(d.order).toEqual(['b', 'a'])
  })
})

describe('blockVisible', () => {
  const now = Date.parse('2026-06-15T12:00:00Z')

  it('is visible with no visibility set', () => {
    expect(blockVisible(block('a'), now)).toBe(true)
  })
  it('respects an empty visibility object', () => {
    expect(blockVisible(block('a', { visibility: {} }), now)).toBe(true)
  })
  it('is hidden when the hidden flag is set', () => {
    expect(blockVisible(block('a', { visibility: { hidden: true } }), now)).toBe(false)
  })
  it('is hidden before the from time', () => {
    expect(blockVisible(block('a', { visibility: { from: '2026-07-01T00:00:00Z' } }), now)).toBe(false)
  })
  it('is hidden at or after the to time', () => {
    expect(blockVisible(block('a', { visibility: { to: '2026-06-01T00:00:00Z' } }), now)).toBe(false)
  })
  it('is visible inside the window', () => {
    expect(
      blockVisible(block('a', { visibility: { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' } }), now)
    ).toBe(true)
  })
  it('defaults now to Date.now()', () => {
    expect(blockVisible(block('a'))).toBe(true)
  })
})

describe('cloneDoc', () => {
  it('rewrites every id and keeps slot references pointing at the new ids', () => {
    const doc: PageDoc = {
      schemaVersion: 1,
      blocks: {
        root: block('root', { children: { main: ['child'] }, props: { deep: { n: 1 } } }),
        child: block('child'),
      },
      order: ['root'],
    }
    let i = 0
    const clone = cloneDoc(doc, () => `new${i++}`)
    expect(clone.order).toEqual(['new0'])
    const newRoot = clone.blocks.new0
    expect(newRoot.children).toEqual({ main: ['new1'] })
    expect(clone.blocks.new1).toBeDefined()
    // structuredClone: props are deep-copied, not shared.
    expect((newRoot.props as any).deep).toEqual({ n: 1 })
    expect((newRoot.props as any).deep).not.toBe((doc.blocks.root.props as any).deep)
  })

  it('handles a block with no children', () => {
    const doc: PageDoc = { schemaVersion: 1, blocks: { a: block('a') }, order: ['a'] }
    const clone = cloneDoc(doc, () => 'z')
    expect(clone.order).toEqual(['z'])
    expect(clone.blocks.z.children).toBeUndefined()
  })
})
