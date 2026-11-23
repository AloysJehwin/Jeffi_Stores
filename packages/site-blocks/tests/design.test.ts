import { describe, it, expect } from 'vitest'
import {
  applyOp,
  applyOps,
  breakpointTokens,
  canRedo,
  canUndo,
  classVariants,
  createHistory,
  DesignError,
  endGesture,
  findNode,
  freshId,
  record,
  redo,
  tokenBreakpoint,
  treeIds,
  undo,
  withBreakpoint,
  MAX_HISTORY,
  type DesignOp,
} from '@jeffi/site-blocks/design'
import { isTagNode, type CodeNode } from '@jeffi/site-blocks'

const lit = (v: string) => ({ k: 'lit' as const, v })
const text = (id: string, value: string): CodeNode => ({ t: 'text', value, id })
const el = (id: string, tag: string, children: CodeNode[] = [], className?: string): CodeNode => ({ t: 'el', tag, props: className ? { className: lit(className) } : {}, children, id })

// <section e1> <h2 e2>Title</h2> <p e3 class="text-sm md:text-base">Copy</p> <ul e4><li e5>A</li><li e6>B</li></ul> <PaymentStep e7 locked/> </section>
function tree(): CodeNode {
  return el('e1', 'section', [
    el('e2', 'h2', [text('e2.0', 'Title')]),
    el('e3', 'p', [text('e3.0', 'Copy')], 'text-sm md:text-base'),
    el('e4', 'ul', [el('e5', 'li', [text('e5.0', 'A')]), el('e6', 'li', [text('e6.0', 'B')])]),
    { t: 'cmp', name: 'PaymentStep', props: {}, children: [], id: 'e7', locked: true },
    {
      t: 'cmp',
      name: 'Products',
      props: { className: { k: 'tpl', parts: ['grid ', { k: 'path', root: 'x', path: [] }] } },
      children: [],
      id: 'e8',
      ro: true,
      render: { param: 'p', body: el('e9', 'div', [{ t: 'expr', value: { k: 'path', root: 'p', path: ['name'] }, id: 'e9.0' }]) },
    },
    { t: 'cond', test: { k: 'lit', v: true }, then: el('e10', 'b', [text('e10.0', 'Yes')]), id: 'e1.5' },
  ])
}

const node = (t: CodeNode, id: string) => findNode(t, id)!.node
const kids = (t: CodeNode, id: string) => {
  const n = node(t, id)
  return n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children.map(c => c.id) : []
}
const cls = (t: CodeNode, id: string) => {
  const n = node(t, id)
  return isTagNode(n) ? (n.props.className as { v?: unknown } | undefined)?.v : undefined
}

/** Applies, checks the inverse restores the tree exactly, and returns the result. */
function roundTrip(t: CodeNode, op: DesignOp) {
  const r = applyOp(t, op)
  expect(applyOp(r.tree, r.inverse).tree).toEqual(t)
  return r
}

describe('class tokens by breakpoint', () => {
  it('reads variants outside brackets and the breakpoint a token applies from', () => {
    expect(classVariants('md:[&>p]:mt-2')).toEqual({ variants: ['md', '[&>p]'], utility: 'mt-2' })
    expect(classVariants('bg-[url(a:b)]')).toEqual({ variants: [], utility: 'bg-[url(a:b)]' })
    expect(tokenBreakpoint('px-4')).toBe('base')
    expect(tokenBreakpoint('hover:md:px-4')).toBe('md')
    expect(tokenBreakpoint('lg:hover:px-4')).toBe('lg')
    expect(tokenBreakpoint('max-md:hidden')).toBe('other')
    expect(tokenBreakpoint('2xl:p-1')).toBe('2xl')
  })

  it('replaces one breakpoint in place and keeps the others', () => {
    const c = 'p-2 md:p-4 text-sm md:text-lg lg:p-8'
    expect(breakpointTokens(c, 'md')).toEqual(['md:p-4', 'md:text-lg'])
    expect(withBreakpoint(c, 'md', ['md:p-6'])).toBe('p-2 md:p-6 text-sm lg:p-8')
    expect(withBreakpoint(c, 'xl', ['xl:p-10'])).toBe(`${c} xl:p-10`)
    expect(withBreakpoint(c, 'base', [])).toBe('md:p-4 md:text-lg lg:p-8')
    expect(() => withBreakpoint(c, 'md', ['p-6'])).toThrow(DesignError)
    expect(() => withBreakpoint(c, 'md', ['md:p-6 md:p-2'])).toThrow(DesignError)
  })
})

describe('design operations', () => {
  it('finds nodes in children, branches and render functions, and lists ids', () => {
    const t = tree()
    expect(findNode(t, 'e9')?.path).toEqual([4, -3])
    expect(findNode(t, 'e10')?.path).toEqual([5, -1])
    expect(findNode(t, 'nope')).toBeNull()
    expect(treeIds(t)).toContain('e9.0')
    expect(freshId(treeIds(t))).toBe('e11')
    expect(freshId(new Set(['e1', 'e3', 'hero', 'e2.0']))).toBe('e4')
  })

  it('sets text on a text node or an element holding only text, and refuses mixed content', () => {
    const t = tree()
    expect(node(roundTrip(t, { op: 'text', id: 'e2.0', value: 'New' }).tree, 'e2.0')).toMatchObject({ value: 'New' })
    const r = roundTrip(t, { op: 'text', id: 'e2', value: 'Heading' })
    expect(node(r.tree, 'e2')).toMatchObject({ children: [{ t: 'text', value: 'Heading', id: 'e2.0' }] })
    expect(kids(roundTrip(t, { op: 'text', id: 'e2', value: '' }).tree, 'e2')).toEqual([])
    expect(() => applyOp(t, { op: 'text', id: 'e4', value: 'x' })).toThrow(/more than text/)
    expect(() => applyOp(t, { op: 'text', id: 'e8', value: 'x' })).toThrow(DesignError)
    // Several text nodes come back as they were.
    const split = el('e1', 'p', [text('e1.0', 'a'), text('e1.1', 'b')])
    const s = roundTrip(split, { op: 'text', id: 'e1', value: 'ab' })
    expect(s.inverse.op).toBe('node')
  })

  it('sets one breakpoint of classes, undoes to the exact string, and refuses data-built classes', () => {
    const t = tree()
    const r = roundTrip(t, { op: 'classes', id: 'e3', bp: 'md', value: ['md:text-xl', 'md:mt-2'] })
    expect(cls(r.tree, 'e3')).toBe('text-sm md:text-xl md:mt-2')
    expect(r.inverse).toEqual({ op: 'attr', id: 'e3', name: 'className', value: 'text-sm md:text-base' })
    expect(cls(roundTrip(t, { op: 'classes', id: 'e2', bp: 'lg', value: ['lg:text-5xl'] }).tree, 'e2')).toBe('lg:text-5xl')
    expect(node(applyOp(t, { op: 'classes', id: 'e2', bp: 'lg', value: [] }).tree, 'e2')).toEqual(node(t, 'e2'))
    expect(() => applyOp(t, { op: 'classes', id: 'e8', bp: 'base', value: ['grid'] })).toThrow(/built from data/)
    expect(() => applyOp(t, { op: 'classes', id: 'e2.0', bp: 'base', value: ['x'] })).toThrow(/isn't an element/)
  })

  it('sets and clears literal attributes, never data-bound or unsafe ones', () => {
    const t = tree()
    const r = roundTrip(t, { op: 'attr', id: 'e2', name: 'aria-label', value: 'Title' })
    expect((node(r.tree, 'e2') as { props: Record<string, unknown> }).props['aria-label']).toEqual(lit('Title'))
    roundTrip(r.tree, { op: 'attr', id: 'e2', name: 'aria-label', value: null })
    roundTrip(t, { op: 'attr', id: 'e3', name: 'className', value: null })
    for (const name of ['onClick', 'style', 'data-e', 'key', 'dangerouslySetInnerHTML', 'x y']) expect(() => applyOp(t, { op: 'attr', id: 'e2', name, value: 'x' })).toThrow(DesignError)
    expect(() => applyOp(t, { op: 'attr', id: 'e8', name: 'className', value: 'x' })).toThrow(/comes from data/)
    expect(() => applyOp(t, { op: 'attr', id: 'e2', name: 'title', value: {} as never })).toThrow(DesignError)
  })

  it('inserts and removes, keeping ids unique and locked parts on the page', () => {
    const t = tree()
    const r = roundTrip(t, { op: 'insert', parent: 'e4', index: 1, node: el('e20', 'li', [text('e20.0', 'New')]) })
    expect(kids(r.tree, 'e4')).toEqual(['e5', 'e20', 'e6'])
    expect(() => applyOp(t, { op: 'insert', parent: 'e4', index: 0, node: el('e5', 'li') })).toThrow(/taken/)
    expect(() => applyOp(t, { op: 'insert', parent: 'e4', index: 9, node: el('e30', 'li') })).toThrow(/range/)
    expect(() => applyOp(t, { op: 'insert', parent: 'e2.0', index: 0, node: el('e30', 'li') })).toThrow(/can't hold/)
    expect(() => applyOp(t, { op: 'insert', parent: 'e4', index: 0, node: { t: 'el', tag: 'li', props: {}, children: [] } })).toThrow(/needs an id/)
    expect(() => applyOp(t, { op: 'insert', parent: 'e4', index: 0, node: el('1bad', 'li') })).toThrow(/valid id/)
    const gone = roundTrip(t, { op: 'remove', id: 'e5' })
    expect(kids(gone.tree, 'e4')).toEqual(['e6'])
    expect(() => applyOp(t, { op: 'remove', id: 'e7' })).toThrow(/needed/)
    expect(() => applyOp(t, { op: 'remove', id: 'e1' })).toThrow(/root/)
    expect(() => applyOp(t, { op: 'remove', id: 'e10' })).toThrow(/slot/)
    expect(() => applyOp(t, { op: 'remove', id: 'zz' })).toThrow(/No node/)
  })

  it('moves within a parent either way, across parents, and keeps locked parts movable', () => {
    const t = tree()
    expect(kids(roundTrip(t, { op: 'move', id: 'e2', parent: 'e1', index: 3 }).tree, 'e1')).toEqual(['e3', 'e4', 'e2', 'e7', 'e8', 'e1.5'])
    expect(kids(roundTrip(t, { op: 'move', id: 'e4', parent: 'e1', index: 0 }).tree, 'e1')).toEqual(['e4', 'e2', 'e3', 'e7', 'e8', 'e1.5'])
    expect(kids(roundTrip(t, { op: 'move', id: 'e3', parent: 'e1', index: 1 }).tree, 'e1')).toEqual(kids(t, 'e1'))
    const across = roundTrip(t, { op: 'move', id: 'e5', parent: 'e1', index: 0 })
    expect(kids(across.tree, 'e1')[0]).toBe('e5')
    expect(kids(across.tree, 'e4')).toEqual(['e6'])
    expect(kids(roundTrip(t, { op: 'move', id: 'e7', parent: 'e1', index: 0 }).tree, 'e1')[0]).toBe('e7')
    expect(() => applyOp(t, { op: 'move', id: 'e4', parent: 'e5', index: 0 })).toThrow(/inside itself/)
  })

  it('duplicates with fresh ids, repeats exactly on redo, and keeps once-only parts single', () => {
    const t = tree()
    const r = roundTrip(t, { op: 'duplicate', id: 'e4' })
    expect(kids(r.tree, 'e1')).toEqual(['e2', 'e3', 'e4', 'e11', 'e7', 'e8', 'e1.5'])
    expect(kids(r.tree, 'e11')).toEqual(['e12', 'e13'])
    expect(kids(r.tree, 'e12')).toEqual(['e12.0'])
    expect(r.op).toEqual({ op: 'duplicate', id: 'e4', as: 'e11' })
    expect(applyOp(t, r.op).tree).toEqual(r.tree)
    expect(kids(applyOp(t, { op: 'duplicate', id: 'e2', as: 'copy' }).tree, 'e1')[1]).toBe('copy')
    expect(() => applyOp(t, { op: 'duplicate', id: 'e2', as: 'e3' })).toThrow(/copy's id/)
    expect(() => applyOp(t, { op: 'duplicate', id: 'e7' })).toThrow(/once/)
    // A text node's copy gets a suffixed id.
    const dt = applyOp(t, { op: 'duplicate', id: 'e2.0' })
    expect(kids(dt.tree, 'e2')).toEqual(['e2.0', 'e2.0~1'])
  })

  it('wraps siblings and unwraps, each undoing the other', () => {
    const t = tree()
    const w = roundTrip(t, { op: 'wrap', ids: ['e2', 'e3'], wrapper: { tag: 'div', props: { className: lit('flex gap-4') } } })
    expect(kids(w.tree, 'e1')).toEqual(['e11', 'e4', 'e7', 'e8', 'e1.5'])
    expect(kids(w.tree, 'e11')).toEqual(['e2', 'e3'])
    expect(w.op).toMatchObject({ wrapper: { id: 'e11' } })
    const u = roundTrip(t, { op: 'unwrap', id: 'e4' })
    expect(kids(u.tree, 'e1')).toEqual(['e2', 'e3', 'e5', 'e6', 'e7', 'e8', 'e1.5'])
    expect(() => applyOp(t, { op: 'wrap', ids: ['e2', 'e4'], wrapper: { tag: 'div' } })).toThrow(/next to each other/)
    expect(() => applyOp(t, { op: 'wrap', ids: [], wrapper: { tag: 'div' } })).toThrow(/Nothing/)
    expect(() => applyOp(t, { op: 'wrap', ids: ['e2'], wrapper: { tag: 'Div x' } })).toThrow(/isn't a tag/)
    expect(() => applyOp(t, { op: 'wrap', ids: ['e2'], wrapper: { tag: 'div', id: 'e3' } })).toThrow(/wrapper's id/)
    expect(() => applyOp(t, { op: 'unwrap', id: 'e7' })).toThrow(/Only an element/)
    expect(() => applyOp(t, { op: 'unwrap', id: 'e1' })).toThrow(/root/)
    expect(() => applyOp(el('e1', 'div', [el('e2', 'p')]), { op: 'unwrap', id: 'e2' })).toThrow(/Nothing inside/)
  })

  it('replaces a node or the whole tree', () => {
    const t = tree()
    const n = roundTrip(t, { op: 'node', id: 'e10', node: el('e10', 'i', [text('e10.0', 'Maybe')]) })
    expect(node(n.tree, 'e10')).toMatchObject({ tag: 'i' })
    expect(() => applyOp(t, { op: 'node', id: 'e10', node: el('e2', 'i') })).toThrow(/taken/)
    expect(() => applyOp(t, { op: 'node', id: 'e10', node: null as never })).toThrow(/Not a node/)
    roundTrip(t, { op: 'replace', tree: el('e1', 'div') })
    expect(() => applyOp(t, { op: 'replace', tree: null as never })).toThrow(/Not a tree/)
    expect(() => applyOp(t, { op: 'nope' } as never)).toThrow(/Unknown/)
  })

  it('applies a list and returns one inverse list', () => {
    const t = tree()
    const r = applyOps(t, [
      { op: 'text', id: 'e2.0', value: 'A' },
      { op: 'remove', id: 'e5' },
      { op: 'duplicate', id: 'e6' },
    ])
    expect(r.ops[2]).toMatchObject({ as: 'e11' })
    expect(applyOps(r.tree, r.inverse).tree).toEqual(t)
  })
})

describe('history', () => {
  it('undoes and redoes steps, and drops the future on a new edit', () => {
    let h = createHistory(tree())
    const start = h.tree
    expect(canUndo(h)).toBe(false)
    h = record(h, [{ op: 'text', id: 'e2.0', value: 'One' }])
    h = record(h, [{ op: 'duplicate', id: 'e4' }])
    const two = h.tree
    h = undo(undo(h))
    expect(h.tree).toEqual(start)
    expect(canRedo(h)).toBe(true)
    h = redo(redo(h))
    expect(h.tree).toEqual(two)
    h = undo(h)
    h = record(h, [{ op: 'remove', id: 'e5' }])
    expect(canRedo(h)).toBe(false)
    expect(undo(createHistory(start))).toEqual(createHistory(start))
    expect(redo(h)).toBe(h)
    expect(record(h, [])).toBe(h)
  })

  it('groups a gesture into one step until it ends', () => {
    let h = createHistory(tree())
    const start = h.tree
    for (const v of ['T', 'Ty', 'Typ']) h = record(h, [{ op: 'text', id: 'e2.0', value: v }], 'typing')
    expect(h.past).toHaveLength(1)
    h = endGesture(h)
    expect(endGesture(h)).toBe(h)
    h = record(h, [{ op: 'text', id: 'e2.0', value: 'Typed' }], 'typing')
    expect(h.past).toHaveLength(2)
    h = undo(undo(h))
    expect(h.tree).toEqual(start)
  })

  it('leaves the history as it was when an operation fails, and caps its length', () => {
    let h = createHistory(tree())
    expect(() => record(h, [{ op: 'text', id: 'e2.0', value: 'ok' }, { op: 'remove', id: 'e7' }])).toThrow(DesignError)
    expect(h.past).toHaveLength(0)
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = record(h, [{ op: 'text', id: 'e2.0', value: String(i) }])
    expect(h.past).toHaveLength(MAX_HISTORY)
  })
})
