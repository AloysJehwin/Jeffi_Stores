import { isTagNode, type CodeNode, type TagNode } from '@jeffi/site-blocks'
import { findNode } from '@jeffi/site-blocks/design'

// How the editor names and reads a section's nodes (the inspector, the layers).

const TAGS: Record<string, string> = {
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  p: 'Paragraph', a: 'Link', img: 'Picture', button: 'Button', section: 'Section', header: 'Header', footer: 'Footer',
  div: 'Box', span: 'Text', ul: 'List', ol: 'List', li: 'List item', strong: 'Bold', b: 'Bold', em: 'Italic', i: 'Italic',
  nav: 'Navigation', article: 'Card', figure: 'Figure', figcaption: 'Caption', blockquote: 'Quote', small: 'Small text',
  br: 'Line break', hr: 'Divider', label: 'Label', main: 'Main', aside: 'Aside', picture: 'Picture', video: 'Video',
}
const PARTS: Record<string, string> = { Image: 'Picture', Link: 'Link', Icon: 'Icon' }

/** A box the editor made by grouping (`role="group"`). */
export const isGroup = (n: CodeNode) => n.t === 'el' && n.tag === 'div' && n.props.role?.k === 'lit' && n.props.role.v === 'group'

/** An element that holds other elements: a pasted copy goes inside it rather than after it. */
export const isFrameNode = (n: CodeNode) => n.t === 'el' && ['div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure'].includes(n.tag)

export function nodeName(n: CodeNode): string {
  switch (n.t) {
    case 'el':
      return isGroup(n) ? 'Group' : (TAGS[n.tag] ?? `<${n.tag}>`)
    case 'cmp':
      return PARTS[n.name] ?? n.name.replace(/([a-z])([A-Z])/g, '$1 $2')
    case 'text':
      return 'Text'
    case 'expr':
      return 'Store data'
    case 'cond':
      return 'Shown when…'
    case 'each':
      return 'Repeated for each item'
    case 'frag':
      return 'Group'
  }
}

/** The words a node shows when they are written out (a few, for a label). */
export function nodeWords(n: CodeNode, max = 40): string {
  const out: string[] = []
  const walk = (x: CodeNode) => {
    if (out.join(' ').length > max) return
    if (x.t === 'text') out.push(x.value.trim())
    else if (x.t === 'el' || x.t === 'cmp' || x.t === 'frag') x.children.forEach(walk)
  }
  walk(n)
  const s = out.filter(Boolean).join(' ').replace(/\s+/g, ' ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** The node's children that are written-out words, each editable by its own id. */
export const textChildren = (n: CodeNode): Extract<CodeNode, { t: 'text' }>[] =>
  isTagNode(n) && !(n.t === 'cmp' && n.render) ? n.children.filter((c): c is Extract<CodeNode, { t: 'text' }> => c.t === 'text' && !!c.id) : []

/** An element holding only written-out words (or nothing): its text is set whole, which the canvas shows at once. */
export const wordsOnly = (n: CodeNode): n is TagNode => isTagNode(n) && !(n.t === 'cmp' && n.render) && n.children.length <= 1 && n.children.every(c => c.t === 'text')

/** The tag nodes from the section's root down to `id` (breadcrumbs). */
export function pathTo(tree: CodeNode, id: string): TagNode[] {
  const loc = findNode(tree, id)
  if (!loc) return []
  const out: TagNode[] = []
  let at: CodeNode = tree
  if (isTagNode(at)) out.push(at)
  for (const step of loc.path) {
    const next: CodeNode | undefined =
      step >= 0
        ? at.t === 'el' || at.t === 'cmp' || at.t === 'frag'
          ? at.children[step]
          : undefined
        : at.t === 'cond'
          ? step === -1
            ? at.then
            : at.else
          : at.t === 'cmp' && at.render
            ? at.render.body
            : at.t === 'each'
              ? at.body
              : undefined
    if (!next) break
    at = next
    if (isTagNode(at)) out.push(at)
  }
  return out
}

/** Whether the node draws data the editor doesn't change (a render function's body, a list over store data). */
export function insideData(tree: CodeNode, id: string): boolean {
  const loc = findNode(tree, id)
  if (!loc) return false
  let at: CodeNode = tree
  for (const step of loc.path) {
    if (step === -3) return true
    const next: CodeNode | undefined = step >= 0 && (at.t === 'el' || at.t === 'cmp' || at.t === 'frag') ? at.children[step] : at.t === 'cond' ? (step === -1 ? at.then : at.else) : undefined
    if (!next) return false
    at = next
  }
  return false
}

/** The node holding `id` in its children, and where; null for the root or a node filling a slot. */
export function parentOf(tree: CodeNode, id: string): { parent: CodeNode; index: number } | null {
  const loc = findNode(tree, id)
  const last = loc?.path[loc.path.length - 1]
  if (!loc || last === undefined || last < 0) return null
  let at: CodeNode = tree
  for (const step of loc.path.slice(0, -1)) {
    const next: CodeNode | undefined =
      step >= 0 ? (at.t === 'el' || at.t === 'cmp' || at.t === 'frag' ? at.children[step] : undefined) : at.t === 'cond' ? (step === -1 ? at.then : at.else) : at.t === 'cmp' && at.render ? at.render.body : at.t === 'each' ? at.body : undefined
    if (!next) return null
    at = next
  }
  return { parent: at, index: last }
}

const holds = (n: CodeNode) => (n.t === 'el' && !['img', 'br', 'hr', 'input'].includes(n.tag)) || n.t === 'frag'

/**
 * Where a new element goes: right after the selected one, or at the end of the selected container when that is the
 * section itself or fills a slot (a branch, a render function's body).
 */
export function insertPlace(tree: CodeNode, selected: string | null): { parent: string; index: number } | null {
  const at = selected ? findNode(tree, selected)?.node : tree
  if (!at) return null
  const p = selected && selected !== tree.id ? parentOf(tree, selected) : null
  if (p?.parent.id) return { parent: p.parent.id, index: p.index + 1 }
  const host = holds(at) ? at : holds(tree) ? tree : null
  return host?.id && (host.t === 'el' || host.t === 'frag') ? { parent: host.id, index: host.children.length } : null
}

export type NewKind = 'heading' | 'paragraph' | 'button' | 'picture' | 'box' | 'divider'
export const NEW_KINDS: { kind: NewKind; label: string }[] = [
  { kind: 'heading', label: 'Heading' },
  { kind: 'paragraph', label: 'Paragraph' },
  { kind: 'button', label: 'Button' },
  { kind: 'picture', label: 'Picture' },
  { kind: 'box', label: 'Box' },
  { kind: 'divider', label: 'Divider' },
]

const lit = (v: string) => ({ k: 'lit' as const, v })
const words = (id: string, value: string): CodeNode[] => [{ t: 'text', value, id: `${id}.0` }]

/** A new element in the theme's look, with the given id (its words take `<id>.0`). */
export function newNode(kind: NewKind, id: string): CodeNode {
  switch (kind) {
    case 'heading':
      return { t: 'el', tag: 'h2', id, props: { className: lit('font-display text-3xl font-semibold text-foreground') }, children: words(id, 'A new heading') }
    case 'paragraph':
      return { t: 'el', tag: 'p', id, props: { className: lit('text-base text-foreground-secondary') }, children: words(id, 'Write a few words here.') }
    case 'button':
      return {
        t: 'cmp',
        name: 'Link',
        id,
        props: { href: lit('/products'), className: lit('inline-flex items-center justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700') },
        children: words(id, 'Shop now'),
      }
    case 'picture':
      return { t: 'cmp', name: 'Image', id, props: { alt: lit(''), aspect: lit('4:3'), className: lit('w-full rounded-xl') }, children: [] }
    case 'box':
      return { t: 'el', tag: 'div', id, props: { className: lit('flex flex-col gap-4') }, children: [] }
    case 'divider':
      return { t: 'el', tag: 'hr', id, props: { className: lit('border-border-default') }, children: [] }
  }
}

/** A new code section's tree: a heading and a line of text in the page's width. */
export const newSectionTree = (): CodeNode => ({
  t: 'el',
  tag: 'section',
  id: 'e1',
  props: { className: lit('py-16') },
  children: [
    {
      t: 'el',
      tag: 'div',
      id: 'e2',
      props: { className: lit('mx-auto max-w-7xl px-4 sm:px-6 lg:px-8') },
      children: [newNode('heading', 'e3'), { ...(newNode('paragraph', 'e4') as Extract<CodeNode, { t: 'el' }>), props: { className: lit('mt-3 text-base text-foreground-secondary') } }],
    },
  ],
})

/** A node's literal prop, when it is written out. */
export const litProp = (n: CodeNode, name: string): string | null => {
  if (!isTagNode(n)) return null
  const v = n.props[name]
  return v && v.k === 'lit' && typeof v.v === 'string' ? v.v : v ? null : ''
}

/** Whether a subtree holds a part the page can't lose. */
export function hasLocked(n: CodeNode): boolean {
  if (isTagNode(n) && n.locked) return true
  const kids = n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children : []
  const slots = n.t === 'cmp' && n.render ? [n.render.body] : n.t === 'cond' ? [n.then, ...(n.else ? [n.else] : [])] : n.t === 'each' ? [n.body] : []
  return [...kids, ...slots].some(hasLocked)
}
