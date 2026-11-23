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

export function nodeName(n: CodeNode): string {
  switch (n.t) {
    case 'el':
      return TAGS[n.tag] ?? `<${n.tag}>`
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
