import { describe, it, expect } from 'vitest'
import { moveBlock, removeBlock, updateBlock, type CodeNode, type PageDoc } from '@jeffi/site-blocks'
import { DesignError } from '@jeffi/site-blocks/design'
import { adoptSaved, canRedo, canUndo, createEditor, currentTrees, docToSave, editDoc, editSection, endGestures, liveTree, redo, undo } from '@/components/site-editor/state'

const text = (id: string, value: string): CodeNode => ({ t: 'text', value, id })
const tree = (h: string): CodeNode => ({ t: 'el', tag: 'section', props: {}, id: 'e1', children: [{ t: 'el', tag: 'h2', props: {}, id: 'e2', children: [text('e2.0', h)] }] })
const words = (t: CodeNode) => JSON.stringify(t).match(/"value":"([^"]*)"/)?.[1]

function page(): PageDoc {
  return {
    schemaVersion: 1,
    order: ['a', 'b', 'c'],
    blocks: {
      a: { id: 'a', type: 'code_section', v: 1, props: { label: 'Hero', source: 'printed a', tree: tree('Hello'), compiled: { id: 'cs-a' } } },
      b: { id: 'b', type: 'code_section', v: 1, props: { label: 'Story', source: 'printed b', tree: tree('Story'), compiled: { id: 'cs-b' } } },
      c: { id: 'c', type: 'rich_text', v: 1, props: { html: '<p>x</p>' } },
    },
  }
}

describe('the visual editor state', () => {
  it('keeps a history per code section and leaves classic blocks alone', () => {
    const s = createEditor(page())
    expect(Object.keys(s.trees)).toEqual(['a', 'b'])
    expect(canUndo(s)).toBe(false)
  })

  it('undoes and redoes across sections in the order the edits were made', () => {
    let s = createEditor(page())
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'One' }])
    s = editSection(s, 'b', [{ op: 'text', id: 'e2', value: 'Two' }])
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Three' }])
    let r = undo(s)
    expect(r.shown).toEqual({ block: 'a', ops: [{ op: 'text', id: 'e2', value: 'One' }] })
    r = undo(r.state)
    expect(r.shown).toMatchObject({ block: 'b' })
    expect(words(r.state.trees.b.tree)).toBe('Story')
    expect(words(r.state.trees.a.tree)).toBe('One')
    r = redo(r.state)
    expect(words(r.state.trees.b.tree)).toBe('Two')
    expect(canRedo(r.state)).toBe(true)
    // A new edit drops what could be redone, in every section.
    const n = editSection(r.state, 'b', [{ op: 'text', id: 'e2', value: 'Four' }])
    expect(canRedo(n)).toBe(false)
    expect(n.trees.a.future).toEqual([])
  })

  it('groups a gesture into one step, ended by another section or explicitly', () => {
    let s = createEditor(page())
    for (const v of ['T', 'Ty', 'Typ']) s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: v }], 'text:e2')
    expect(s.past).toHaveLength(1)
    s = editSection(s, 'b', [{ op: 'text', id: 'e2', value: 'B' }], 'text:e2')
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Typed' }], 'text:e2')
    expect(s.past).toHaveLength(3)
    s = endGestures(s)
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Again' }], 'text:e2')
    expect(s.past).toHaveLength(4)
    let r = undo(s)
    r = undo(r.state)
    expect(words(r.state.trees.a.tree)).toBe('Typ')
  })

  it('records block-list changes as steps the canvas reloads for', () => {
    let s = createEditor(page())
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Edited' }])
    s = editDoc(s, d => moveBlock(d, 'c', 0))
    expect(s.doc.order).toEqual(['c', 'a', 'b'])
    s = editDoc(s, d => removeBlock(d, 'b'))
    let r = undo(s)
    expect(r.shown).toBe('reload')
    expect(r.state.doc.order).toEqual(['c', 'a', 'b'])
    r = undo(r.state)
    r = undo(r.state)
    expect(words(r.state.trees.a.tree)).toBe('Hello')
    expect(r.state.doc.order).toEqual(['a', 'b', 'c'])
    expect(editDoc(s, d => d)).toBe(s)
  })

  it('gives a section added to the page a history of its own', () => {
    let s = createEditor(page())
    const copy = { ...structuredClone(s.doc.blocks.a), id: 'a2', props: { ...s.doc.blocks.a.props, tree: s.trees.a.tree } }
    s = editDoc(s, d => ({ ...d, blocks: { ...d.blocks, a2: copy }, order: [...d.order, 'a2'] }))
    s = editSection(s, 'a2', [{ op: 'text', id: 'e2', value: 'Copy' }])
    expect(words(s.trees.a2.tree)).toBe('Copy')
    expect(words(s.trees.a.tree)).toBe('Hello')
  })

  it('refuses an operation that does not apply, leaving the state as it was', () => {
    const s = createEditor(page())
    expect(() => editSection(s, 'a', [{ op: 'remove', id: 'nope' }])).toThrow(DesignError)
    expect(() => editSection(s, 'c', [{ op: 'text', id: 'e2', value: 'x' }])).toThrow(/no tree/)
    expect(s.rev).toBe(0)
  })

  it('saves code sections as their trees with an empty source, so the server compiles the tree', () => {
    let s = createEditor(page())
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Saved' }])
    const doc = docToSave(s)
    expect(doc.blocks.a.props).toMatchObject({ label: 'Hero', source: '' })
    expect(words(doc.blocks.a.props.tree as CodeNode)).toBe('Saved')
    expect(doc.blocks.b.props.source).toBe('')
    expect(doc.blocks.c).toBe(s.doc.blocks.c)
    expect(Object.keys(currentTrees(s))).toEqual(['a', 'b'])
  })

  it("takes the server's tree when it settled one differently, unless the section changed since", () => {
    let s = createEditor(page())
    s = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Sent' }])
    const sent = currentTrees(s)
    const saved = docToSave(s)
    const settled: CodeNode = { ...tree('Sent'), id: 'e1' }
    ;(settled as { children: CodeNode[] }).children.push(text('e1.1', 'extra'))
    saved.blocks.a = { ...saved.blocks.a, props: { ...saved.blocks.a.props, tree: settled } }
    // Same tree back: nothing to take in.
    expect(adoptSaved(s, sent, docToSave(s))).toBe(s)
    const took = adoptSaved(s, sent, saved)
    expect(took.trees.a.tree).toEqual(settled)
    expect(took.trees.a.past).toEqual([])
    // Undo skips the section's steps that are gone.
    expect(undo(took).shown).toBeNull()
    const moved = editSection(s, 'a', [{ op: 'text', id: 'e2', value: 'Newer' }])
    expect(adoptSaved(moved, sent, saved)).toBe(moved)
  })
})

describe('a classic block converted in the editor', () => {
  const convert = (d: PageDoc, h: string) => updateBlock(d, 'c', { type: 'code_section', props: { label: 'Converted', source: 'printed c', tree: tree(h), compiled: { id: 'cs-c' } } })

  it('becomes a section with its own history, and undo makes it classic again', () => {
    let s = createEditor(page())
    expect(liveTree(s, 'c')).toBeNull()
    s = editDoc(s, d => convert(d, 'Converted'))
    expect(words(liveTree(s, 'c')!)).toBe('Converted')
    s = editSection(s, 'c', [{ op: 'text', id: 'e2', value: 'Edited' }])
    expect(docToSave(s).blocks.c.props).toMatchObject({ source: '', tree: { id: 'e1' } })
    let r = undo(undo(s).state)
    expect(r.state.doc.blocks.c.type).toBe('rich_text')
    expect(liveTree(r.state, 'c')).toBeNull()
    expect(docToSave(r.state).blocks.c).toEqual(page().blocks.c)
    expect(currentTrees(r.state).c).toBeUndefined()
    expect(() => editSection(r.state, 'c', [{ op: 'text', id: 'e2', value: 'X' }])).toThrow(DesignError)
    // Redone, it is the section again; converted afresh, it starts over.
    r = redo(r.state)
    expect(words(liveTree(r.state, 'c')!)).toBe('Converted')
    const back = undo(r.state).state
    const again = editDoc(back, d => convert(d, 'Fresh'))
    expect(words(liveTree(again, 'c')!)).toBe('Fresh')
    expect(again.trees.c.past).toEqual([])
  })
})

describe('a classic block’s fields in the editor', () => {
  const html = (d: PageDoc, v: string) => updateBlock(d, 'c', { props: { html: v } })

  it('joins typing in one visit into one step, and keeps other changes apart', () => {
    let s = createEditor(page())
    for (const v of ['<p>a</p>', '<p>ab</p>', '<p>abc</p>']) s = editDoc(s, d => html(d, v), 'fields:c:1')
    expect(s.past).toHaveLength(1)
    s = editDoc(s, d => moveBlock(d, 'c', 0))
    s = editDoc(s, d => html(d, '<p>abcd</p>'), 'fields:c:1')
    expect(s.past).toHaveLength(3)
    s = editDoc(s, d => html(d, '<p>new visit</p>'), 'fields:c:2')
    expect(s.past).toHaveLength(4)
    let r = undo(s)
    expect(r.state.doc.blocks.c.props.html).toBe('<p>abcd</p>')
    r = undo(undo(r.state).state)
    expect(r.state.doc.blocks.c.props.html).toBe('<p>abc</p>')
    r = undo(r.state)
    expect(r.state.doc.blocks.c.props.html).toBe('<p>x</p>')
    expect(canUndo(r.state)).toBe(false)
  })
})

describe('page credits in the editor state', () => {
  it('keeps a stock photo credit with the page for the next save, once per picture', async () => {
    const { addCredit } = await import('@/components/site-editor/state')
    let s = createEditor(page())
    s = addCredit(s, 'https://cdn.example.com/stock/pexels-1.jpg', { name: 'A' })
    s = addCredit(s, 'https://cdn.example.com/stock/pexels-1.jpg', { name: 'A2' })
    expect(s.rev).toBe(2)
    expect(docToSave(s).settings?.credits).toEqual([{ image: 'https://cdn.example.com/stock/pexels-1.jpg', credit: { name: 'A2' } }])
    expect(addCredit(s, 'x', null)).toBe(s)
    expect(canUndo(s)).toBe(false)
  })
})
