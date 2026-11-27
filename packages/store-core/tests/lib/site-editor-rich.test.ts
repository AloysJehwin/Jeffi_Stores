import { describe, it, expect } from 'vitest'
import type { CodeNode } from '@jeffi/site-blocks'
import { applyOp } from '@jeffi/site-blocks/design'
import { isRichText } from '@/lib/site/code/rich'
import { commitOps, mergeRich, normalizeHref, plainText, toChildren, withIds, type DocJson } from '@/components/visitor/site/editor/rich-convert'

const text = (t: string, ...marks: [string, string?][]) => ({ type: 'text', text: t, ...(marks.length ? { marks: marks.map(([type, href]) => ({ type, ...(href ? { attrs: { href } } : {}) })) } : {}) })
const doc = (...content: NonNullable<DocJson['content']>): DocJson => ({ content })
const lit = (v: string) => ({ k: 'lit' as const, v })

describe('rich text: Tiptap JSON to CodeNode children', () => {
  it('keeps plain text as one text node', () => {
    expect(toChildren(doc(text('Hello '), text('world')))).toEqual([{ t: 'text', value: 'Hello world' }])
    expect(plainText(toChildren(doc(text('Hi'))))).toBe('Hi')
    expect(toChildren(doc())).toEqual([])
  })

  it('wraps marks in strong, em, u, s and breaks in br', () => {
    const kids = toChildren(doc(text('a '), text('b', ['bold']), { type: 'hardBreak' }, text('c', ['italic']), text('d', ['underline']), text('e', ['strike'])))
    expect(kids.map(k => (k.t === 'el' ? k.tag : k.t))).toEqual(['text', 'strong', 'br', 'em', 'u', 's'])
    expect(plainText(kids)).toBeNull()
  })

  it('nests overlapping marks and shares an element across a run', () => {
    const kids = toChildren(doc(text('x ', ['bold']), text('y', ['bold'], ['italic']), text(' z', ['bold'])))
    expect(kids).toHaveLength(1)
    const strong = kids[0] as Extract<CodeNode, { t: 'el' }>
    expect(strong.tag).toBe('strong')
    expect(strong.children.map(c => (c.t === 'el' ? `${c.tag}:${(c.children[0] as { value: string }).value}` : (c as { value: string }).value))).toEqual(['x ', 'em:y', ' z'])
  })

  it('puts the link outside the other marks and writes only its href', () => {
    const kids = toChildren(doc(text('go', ['bold'], ['link', '/sale'])))
    expect(kids).toEqual([{ t: 'el', tag: 'a', props: { href: lit('/sale') }, children: [{ t: 'el', tag: 'strong', props: {}, children: [{ t: 'text', value: 'go' }] }] }])
    const withJunk = { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://a.test', target: '_blank', rel: 'noopener', class: 'c' } }] }
    expect((toChildren(doc(withJunk))[0] as { props: object }).props).toEqual({ href: lit('https://a.test') })
  })

  it('accepts /paths, #anchors, https, mailto and tel; refuses the rest (the words stay)', () => {
    for (const ok of ['/about', '#faq', 'https://example.com/a?b=1', 'mailto:hi@example.com', 'tel:+911234567890']) expect(toChildren(doc(text('l', ['link', ok])))[0]).toMatchObject({ tag: 'a' })
    for (const bad of ['javascript:alert(1)', 'http://example.com', '//evil.test', 'data:text/html,x', 'ftp://x.test', ' ']) expect(toChildren(doc(text('l', ['link', bad])))).toEqual([{ t: 'text', value: 'l' }])
  })

  it('normalizes typed links through the allowlist', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com')
    expect(normalizeHref(' www.example.com/x ')).toBe('https://www.example.com/x')
    expect(normalizeHref('/sale')).toBe('/sale')
    expect(normalizeHref('javascript:alert(1)')).toBeNull()
    expect(normalizeHref('http://example.com')).toBeNull()
    expect(normalizeHref('')).toBeNull()
  })
})

describe('rich text: what a commit reports', () => {
  it('gives the plain text op when it held only words and still does', () => {
    expect(commitOps('e5', 'p', doc(text('New words')), true)).toEqual({ ops: [{ op: 'text', id: 'e5', value: 'New words' }], rich: false })
    expect(commitOps('e5', 'p', doc(), true).ops).toEqual([{ op: 'text', id: 'e5', value: '' }])
  })

  it('gives one node op with the children otherwise, including when formatting was all removed', () => {
    const r = commitOps('e5', 'li', doc(text('a '), text('b', ['bold'])), true)
    expect(r.rich).toBe(true)
    expect(r.ops).toHaveLength(1)
    expect(r.ops[0]).toMatchObject({ op: 'node', id: 'e5', node: { t: 'el', tag: 'li', id: 'e5' } })
    // Formatting taken out of an element that had it: text op would be refused (it holds more than text).
    expect(commitOps('e5', 'p', doc(text('plain')), false)).toMatchObject({ rich: true, ops: [{ op: 'node' }] })
  })
})

describe('rich text: the editor side', () => {
  const tree: CodeNode = {
    t: 'el',
    tag: 'section',
    id: 'e1',
    props: {},
    children: [
      { t: 'el', tag: 'p', id: 'e2', props: { className: lit('text-lg') }, children: [{ t: 'text', value: 'Old ', id: 'e2.0' }, { t: 'el', tag: 'strong', id: 'e3', props: {}, children: [{ t: 'text', value: 'bold', id: 'e3.0' }] }] },
      { t: 'el', tag: 'p', id: 'e9', props: {}, children: [{ t: 'text', value: 'x', id: 'e9.0' }] },
    ],
  }

  it('gives new children ids from the whole tree', () => {
    const kids = withIds('e2', toChildren(doc(text('a '), text('b', ['bold']), text('c', ['italic']))), ['e1', 'e2', 'e3', 'e9'])
    expect(kids.map(k => k.id)).toEqual(['e2.0', 'e10', 'e11'])
    expect((kids[1] as Extract<CodeNode, { t: 'el' }>).children[0].id).toBe('e10.0')
  })

  it('keeps the live element (tag, id, props) and takes the new children; undo restores the old ones', () => {
    const { ops } = commitOps('e2', 'p', doc(text('New '), text('words', ['italic'])), false)
    const merged = mergeRich(tree, ops)
    expect(merged).not.toBeNull()
    const op = merged![0] as { node: Extract<CodeNode, { t: 'el' }> }
    expect(op.node).toMatchObject({ tag: 'p', id: 'e2', props: { className: lit('text-lg') } })
    expect(op.node.children.map(c => c.id)).toEqual(['e2.0', 'e10'])
    const applied = applyOp(tree, merged![0])
    const p = (applied.tree as Extract<CodeNode, { t: 'el' }>).children[0] as Extract<CodeNode, { t: 'el' }>
    expect(p.children[1]).toMatchObject({ tag: 'em' })
    const back = applyOp(applied.tree, applied.inverse)
    expect(JSON.stringify(back.tree)).toBe(JSON.stringify(tree))
  })

  it('refuses a commit for an element that is gone or changed tag', () => {
    expect(mergeRich(tree, commitOps('e77', 'p', doc(text('x', ['bold'])), false).ops)).toBeNull()
    expect(mergeRich(tree, commitOps('e2', 'li', doc(text('x', ['bold'])), false).ops)).toBeNull()
    expect(mergeRich(undefined, commitOps('e2', 'p', doc(text('x', ['bold'])), false).ops)).toBeNull()
  })
})

describe('rich text: which elements are rich', () => {
  const el = (tag: string, children: CodeNode[], props: Record<string, ReturnType<typeof lit>> = {}): CodeNode => ({ t: 'el', tag, props, children })
  const t = (v: string): CodeNode => ({ t: 'text', value: v })

  it('takes text blocks with inline formatting, nested within the limit', () => {
    expect(isRichText(el('p', [t('a'), el('strong', [t('b')])]))).toBe(true)
    expect(isRichText(el('td', [el('em', [el('u', [t('b')])])]))).toBe(true)
    expect(isRichText(el('h3', [t('a'), el('a', [t('b')], { href: lit('/x') })]))).toBe(true)
    expect(isRichText(el('span', [t('a'), el('br', [])]))).toBe(true)
  })

  it('leaves out text-only, data, other tags, props and unsupported formatting', () => {
    expect(isRichText(el('p', [t('plain')]))).toBe(false)
    expect(isRichText(el('div', [el('strong', [t('b')])]))).toBe(false)
    expect(isRichText(el('p', [{ t: 'expr', value: lit('x') }, el('strong', [t('b')])]))).toBe(false)
    expect(isRichText(el('p', [el('strong', [{ t: 'cond', test: lit('x'), then: t('a') } as CodeNode])]))).toBe(false)
    expect(isRichText(el('p', [el('strong', [t('b')], { className: lit('x') })]))).toBe(false)
    expect(isRichText(el('p', [el('a', [t('b')], { href: lit('http://x.test') })]))).toBe(false)
    expect(isRichText(el('p', [el('a', [t('b')])]))).toBe(false)
    expect(isRichText(el('p', [el('mark', [t('b')])]))).toBe(false)
    expect(isRichText(el('p', [el('a', [el('a', [t('b')], { href: lit('/y') })], { href: lit('/x') })]))).toBe(false)
    let deep: CodeNode = t('x')
    for (const tag of ['strong', 'em', 'u', 's', 'strong', 'em']) deep = el(tag, [deep])
    expect(isRichText(el('p', [deep]))).toBe(false)
  })
})
