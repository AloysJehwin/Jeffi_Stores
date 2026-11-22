import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  defineBlock,
  createRegistry,
  validateDoc,
  mergeDocs,
  type Block,
  type PageDoc,
} from '@jeffi/site-blocks'

const textDef = defineBlock({
  type: 'text',
  v: 1,
  label: 'Text',
  category: 'content',
  props: z.object({ body: z.string().default('hi') }),
})

const heroDef = defineBlock({
  type: 'hero',
  v: 2,
  label: 'Hero',
  category: 'structure',
  singleton: true,
  pages: ['home'],
  audiences: ['store'],
  surfaces: ['web'],
  props: z.object({ title: z.string() }),
  // migrate from v1: old docs stored `heading` instead of `title`.
  migrate: (props: any, fromV: number) => (fromV === 1 ? { title: props.heading } : props),
})

const block = (id: string, over: Partial<Block> = {}): Block => ({ id, type: 'text', v: 1, props: { body: 'x' }, ...over })

describe('defineBlock', () => {
  it('returns the def unchanged (identity helper for typing)', () => {
    expect(defineBlock(textDef)).toBe(textDef)
  })
})

describe('createRegistry', () => {
  const reg = createRegistry([textDef, heroDef])

  it('get returns a def by type or undefined', () => {
    expect(reg.get('text')).toBe(textDef)
    expect(reg.get('missing')).toBeUndefined()
  })
  it('all returns every def', () => {
    expect(reg.all()).toEqual([textDef, heroDef])
  })
  it('throws when a type is defined twice', () => {
    expect(() => createRegistry([textDef, textDef])).toThrow(/defined twice/)
  })

  describe('allowedOn', () => {
    it('keeps a def with no page/audience/surface constraints everywhere', () => {
      const r = reg.allowedOn({ audience: 'business', surface: 'app', page: 'cart' })
      expect(r).toContain(textDef)
      expect(r).not.toContain(heroDef)
    })
    it('keeps a constrained def only on the matching ref', () => {
      const r = reg.allowedOn({ audience: 'store', surface: 'web', page: 'home' })
      expect(r).toEqual([textDef, heroDef])
    })
    it('drops a def on the wrong page', () => {
      expect(reg.allowedOn({ audience: 'store', surface: 'web', page: 'cart' })).toEqual([textDef])
    })
    it('drops a def on the wrong audience', () => {
      expect(reg.allowedOn({ audience: 'business', surface: 'web', page: 'home' })).toEqual([textDef])
    })
    it('drops a def on the wrong surface', () => {
      expect(reg.allowedOn({ audience: 'store', surface: 'app', page: 'home' })).toEqual([textDef])
    })
  })
})

describe('validateDoc', () => {
  const reg = createRegistry([textDef, heroDef])

  it('parses props so defaults apply and reports ok', () => {
    const doc = { blocks: { a: { id: 'a', type: 'text', v: 1, props: {} } }, order: ['a'] }
    const res = validateDoc(doc, reg)
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
    expect(res.doc.blocks.a.props).toEqual({ body: 'hi' })
  })

  it('drops an unknown block type with an issue', () => {
    const doc = { blocks: { a: { id: 'a', type: 'nope', v: 1, props: {} } }, order: ['a'] }
    const res = validateDoc(doc, reg)
    expect(res.ok).toBe(false)
    expect(res.issues).toEqual([{ blockId: 'a', message: 'Unknown block type nope' }])
    expect(res.doc.blocks.a).toBeUndefined()
  })

  it('drops a block that cannot go on the given page', () => {
    const doc = { blocks: { h: { id: 'h', type: 'hero', v: 2, props: { title: 'T' } } }, order: ['h'] }
    const res = validateDoc(doc, reg, { audience: 'store', surface: 'web', page: 'cart' })
    expect(res.ok).toBe(false)
    expect(res.issues[0].message).toMatch(/can't go on this page/)
  })

  it('keeps a fitting block when a ref is given', () => {
    const doc = { blocks: { h: { id: 'h', type: 'hero', v: 2, props: { title: 'T' } } }, order: ['h'] }
    const res = validateDoc(doc, reg, { audience: 'store', surface: 'web', page: 'home' })
    expect(res.ok).toBe(true)
    expect(res.doc.blocks.h.props).toEqual({ title: 'T' })
  })

  it('keeps the first singleton and drops the rest', () => {
    const doc = {
      blocks: {
        h1: { id: 'h1', type: 'hero', v: 2, props: { title: 'A' } },
        h2: { id: 'h2', type: 'hero', v: 2, props: { title: 'B' } },
      },
      order: ['h1', 'h2'],
    }
    const res = validateDoc(doc, reg)
    expect(res.ok).toBe(false)
    expect(res.issues[0].message).toMatch(/can only appear once/)
    expect(res.doc.blocks.h1).toBeDefined()
    expect(res.doc.blocks.h2).toBeUndefined()
  })

  it('migrates props written for an older version', () => {
    const doc = { blocks: { h: { id: 'h', type: 'hero', v: 1, props: { heading: 'Old' } } }, order: ['h'] }
    const res = validateDoc(doc, reg)
    expect(res.ok).toBe(true)
    expect(res.doc.blocks.h.v).toBe(2)
    expect(res.doc.blocks.h.props).toEqual({ title: 'Old' })
  })

  it('reports a props validation failure and drops the block', () => {
    const doc = { blocks: { h: { id: 'h', type: 'hero', v: 2, props: { title: 123 } } }, order: ['h'] }
    const res = validateDoc(doc, reg)
    expect(res.ok).toBe(false)
    expect(res.issues[0].blockId).toBe('h')
    expect(res.issues[0].message).toMatch(/^Hero: /)
    expect(res.doc.blocks.h).toBeUndefined()
  })
})

// --- merge ---

const doc = (blocks: Record<string, Block>, order: string[]): PageDoc => ({ schemaVersion: 1, blocks, order })

describe('mergeDocs', () => {
  it('keeps a block only the draft changed', () => {
    const base = doc({ a: block('a', { props: { body: 'base' } }) }, ['a'])
    const live = doc({ a: block('a', { props: { body: 'base' } }) }, ['a'])
    const draft = doc({ a: block('a', { props: { body: 'draft' } }) }, ['a'])
    const { doc: out, conflicts } = mergeDocs(base, live, draft)
    expect(out.blocks.a.props).toEqual({ body: 'draft' })
    expect(conflicts).toEqual([])
  })

  it('keeps a block only live changed', () => {
    const base = doc({ a: block('a', { props: { body: 'base' } }) }, ['a'])
    const live = doc({ a: block('a', { props: { body: 'live' } }) }, ['a'])
    const draft = doc({ a: block('a', { props: { body: 'base' } }) }, ['a'])
    const { doc: out, conflicts } = mergeDocs(base, live, draft)
    expect(out.blocks.a.props).toEqual({ body: 'live' })
    expect(conflicts).toEqual([])
  })

  it('no conflict when both sides made the identical change', () => {
    const base = doc({ a: block('a', { props: { body: 'base' } }) }, ['a'])
    const same = block('a', { props: { body: 'same' } })
    const { doc: out, conflicts } = mergeDocs(base, doc({ a: same }, ['a']), doc({ a: same }, ['a']))
    expect(out.blocks.a.props).toEqual({ body: 'same' })
    expect(conflicts).toEqual([])
  })

  it('takes the draft and reports a conflict when both changed differently', () => {
    const base = doc({ a: block('a', { props: { body: 'base' } }) }, ['a'])
    const live = doc({ a: block('a', { props: { body: 'live' } }) }, ['a'])
    const draft = doc({ a: block('a', { props: { body: 'draft' } }) }, ['a'])
    const { doc: out, conflicts } = mergeDocs(base, live, draft)
    expect(out.blocks.a.props).toEqual({ body: 'draft' })
    expect(conflicts).toEqual(['a'])
  })

  it('canonicalizes key order so reordered keys are not a change', () => {
    const base = doc({ a: { id: 'a', type: 'text', v: 1, props: { x: 1, y: 2 } } }, ['a'])
    const live = doc({ a: { id: 'a', type: 'text', v: 1, props: { y: 2, x: 1 } } }, ['a'])
    const draft = doc({ a: { id: 'a', type: 'text', v: 1, props: { x: 1, y: 2 } } }, ['a'])
    const { conflicts } = mergeDocs(base, live, draft)
    expect(conflicts).toEqual([])
  })

  it('drops a block the draft deleted (draft changed to undefined)', () => {
    const base = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const live = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const draft = doc({ a: block('a') }, ['a'])
    const { doc: out } = mergeDocs(base, live, draft)
    expect(out.blocks.b).toBeUndefined()
    expect(out.order).toEqual(['a'])
  })

  it('keeps a block added on the live side', () => {
    const base = doc({ a: block('a') }, ['a'])
    const live = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const draft = doc({ a: block('a') }, ['a'])
    const { doc: out } = mergeDocs(base, live, draft)
    expect(out.blocks.b).toBeDefined()
  })

  it('follows the draft order when the draft reordered', () => {
    const base = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const live = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const draft = doc({ a: block('a'), b: block('b') }, ['b', 'a'])
    const { doc: out } = mergeDocs(base, live, draft)
    expect(out.order).toEqual(['b', 'a'])
  })

  it('follows the live order when the draft did not reorder', () => {
    const base = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const live = doc({ a: block('a'), b: block('b') }, ['b', 'a'])
    const draft = doc({ a: block('a'), b: block('b') }, ['a', 'b'])
    const { doc: out } = mergeDocs(base, live, draft)
    expect(out.order).toEqual(['b', 'a'])
  })

  it('omits nested children from the top-level order', () => {
    const parent = block('p', { type: 'hero', children: { main: ['c'] } })
    const child = block('c')
    const base = doc({ p: parent, c: child }, ['p'])
    const live = doc({ p: parent, c: child }, ['p'])
    const draft = doc({ p: parent, c: child }, ['p'])
    const { doc: out } = mergeDocs(base, live, draft)
    expect(out.order).toEqual(['p'])
  })
})
