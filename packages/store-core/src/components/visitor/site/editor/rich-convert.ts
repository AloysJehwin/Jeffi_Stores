import type { CodeNode } from '@jeffi/site-blocks'
import { findNode, freshId, treeIds, type DesignOp } from '@jeffi/site-blocks/design'
import { safeHref } from '@/lib/site/code/allow'

// Rich text on the canvas, the pure half (rich-text.ts mounts Tiptap): the editor's document as CodeNode children,
// the operation a commit reports, and the editor's side of it (ids and props from the live tree).

export interface DocJson {
  content?: { type: string; text?: string; marks?: { type: string; attrs?: { href?: unknown } }[] }[]
}
type El = Extract<CodeNode, { t: 'el' }>

const TAG: Record<string, string> = { link: 'a', bold: 'strong', italic: 'em', underline: 'u', strike: 's' }
/** Outermost first, so equal runs of marks share one element. */
const ORDER = Object.keys(TAG)

/** A link as typed: `example.com` gets https://; null when the site's allowlist would refuse it. */
export function normalizeHref(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  return safeHref(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(v) ? `https://${v}` : v)
}

/** The document's inline content as nodes without ids: text, br, and strong / em / u / s / a (href only) around runs. */
export function toChildren(doc: DocJson | null | undefined): CodeNode[] {
  const root: CodeNode[] = []
  let open: { key: string; node: El }[] = []
  const into = () => (open.length ? open[open.length - 1].node.children : root)
  const push = (leaf: CodeNode) => {
    const list = into()
    const last = list[list.length - 1]
    if (leaf.t === 'text' && last?.t === 'text') last.value += leaf.value
    else list.push(leaf)
  }
  for (const n of doc?.content ?? []) {
    let leaf: CodeNode
    if (n.type === 'hardBreak') leaf = { t: 'el', tag: 'br', props: {}, children: [] }
    else if (n.type === 'text' && n.text) leaf = { t: 'text', value: n.text }
    else continue
    const marks: { key: string; tag: string; href?: string }[] = []
    for (const m of n.marks ?? []) {
      if (!TAG[m.type]) continue
      // A link the allowlist would refuse stays plain text.
      const href = m.type === 'link' ? (typeof m.attrs?.href === 'string' ? safeHref(m.attrs.href) : null) : undefined
      if (m.type === 'link' && href === null) continue
      marks.push({ key: href ? `link:${href}` : m.type, tag: TAG[m.type], ...(href ? { href } : {}) })
    }
    marks.sort((a, b) => ORDER.indexOf(a.key.split(':')[0]) - ORDER.indexOf(b.key.split(':')[0]))
    let k = 0
    while (k < open.length && k < marks.length && open[k].key === marks[k].key) k++
    open.length = k
    for (; k < marks.length; k++) {
      const m = marks[k]
      const el: El = { t: 'el', tag: m.tag, props: m.href ? { href: { k: 'lit', v: m.href } } : {}, children: [] }
      into().push(el)
      open.push({ key: m.key, node: el })
    }
    push(leaf)
  }
  return root
}

/** The words when nothing but text is left, else null. */
export const plainText = (kids: CodeNode[]): string | null => (kids.every(c => c.t === 'text') ? kids.map(c => (c as { value: string }).value).join('') : null)

/** What a commit reports: `text` while the element held only words and still does; else the node whole (with its
 * children; the editor puts back the tag's own props, see mergeRich). */
export function commitOps(id: string, tag: string, doc: DocJson, wasText: boolean): { ops: DesignOp[]; rich: boolean } {
  const kids = toChildren(doc)
  const plain = plainText(kids)
  if (plain !== null && wasText) return { ops: [{ op: 'text', id, value: plain }], rich: false }
  return { ops: [{ op: 'node', id, node: { t: 'el', tag, props: {}, children: kids, id } }], rich: true }
}

/** Ids for new children: tags get the next free `eN`, other nodes their place under the nearest tag (`e3.1`). */
export function withIds(parent: string, kids: CodeNode[], taken: Iterable<string>): CodeNode[] {
  const used = new Set(taken)
  const go = (list: CodeNode[], at: string): CodeNode[] =>
    list.map((c, i) => {
      if (c.t !== 'el') return { ...c, id: `${at}.${i}` }
      const id = freshId(used)
      used.add(id)
      return { ...c, id, children: go(c.children, id) }
    })
  return go(kids, parent)
}

/** The editor's side of a rich commit: each `node` op keeps the element in the live tree (tag, props, marks) and takes
 * only the new children, with ids from the whole tree. Null when the element is gone or isn't a plain element. */
export function mergeRich(tree: CodeNode | undefined | null, ops: DesignOp[]): DesignOp[] | null {
  if (!tree) return null
  const taken = treeIds(tree)
  const out: DesignOp[] = []
  for (const op of ops) {
    if (op.op !== 'node' || op.node.t !== 'el') return null
    const old = findNode(tree, op.id)?.node
    if (!old || old.t !== 'el' || !old.id || old.tag !== op.node.tag) return null
    out.push({ op: 'node', id: op.id, node: { ...old, children: withIds(old.id, op.node.children, taken) } })
  }
  return out
}
