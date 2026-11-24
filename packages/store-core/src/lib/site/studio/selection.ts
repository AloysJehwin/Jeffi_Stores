import { isTagNode, type CodeNode, type PageKey, type TagNode } from '@jeffi/site-blocks'
import { findNode } from '@jeffi/site-blocks/design'
import { CARD_PAGE } from '../code/ast'
import { CODE_SECTION, sectionTree } from '../code/compile'
import { visitTree } from '../code/ids'
import { printSection } from '../code/print'
import { tweakSection } from './generate'
import type { StudioCtx } from './types'

// "Change with AI" on the visual editor's selection (docs/plans/SITE_EDITOR_PLAN.md phase 4): the section printed
// with its `data-e` ids and the selected ids named, rewritten the way the studio changes a section (tweakSection), and
// read back as the editor's tree. The ids the AI kept keep their nodes, so the editor can show what changed.

const words = (n: CodeNode) => {
  const out: string[] = []
  visitTree(n, x => x.t === 'text' && out.push(x.value.trim()))
  const s = out.filter(Boolean).join(' ').replace(/\s+/g, ' ')
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
}

/** The owner's request with the selection named; the section's root (or nothing) selected means the whole section. */
export function selectionAsk(tree: CodeNode, ids: string[], instruction: string): string {
  const named = ids
    .filter(id => id !== tree.id)
    .map(id => findNode(tree, id)?.node)
    .filter((n): n is TagNode => isTagNode(n))
    .map(n => `<${n.t === 'el' ? n.tag : n.name} data-e="${n.id}">${words(n) ? ` ("${words(n)}")` : ''}`)
  if (!named.length) return instruction
  const which = named.length > 1 ? 'those elements' : 'that element'
  return `The owner selected ${named.join(', ')}. Change ${which} and what is inside as they ask, and leave the rest of the section as it is unless the request needs more: ${instruction}`
}

/** A tag node's own look and words (not its descendants'), to tell which nodes a change touched. */
const signature = (n: CodeNode) =>
  isTagNode(n) ? JSON.stringify([n.t === 'el' ? n.tag : n.name, n.props, n.children.length, n.children.filter(c => c.t === 'text').map(c => (c as { value: string }).value)]) : ''

/** The tag nodes of `after` that are new or changed against `before`, by id. */
export function changedIds(before: CodeNode, after: CodeNode): string[] {
  const old = new Map<string, string>()
  visitTree(before, n => isTagNode(n) && n.id && old.set(n.id, signature(n)))
  const out: string[] = []
  visitTree(after, n => {
    if (isTagNode(n) && n.id && old.get(n.id) !== signature(n)) out.push(n.id)
  })
  return out
}

export interface SelectionChange {
  tree: CodeNode
  changed: string[]
}

/**
 * The section changed as asked, focused on the selection. `key` is the studio plan key the section is on (it decides
 * which parts the compiler allows); the result is the compile's tree of the AI's reply. Throws as tweakSection does,
 * and when the reply has no tree form.
 */
export async function changeSelection(ctx: StudioCtx, p: { label: string; tree: CodeNode; page: PageKey; key?: string; ids: string[]; instruction: string }): Promise<SelectionChange> {
  const source = printSection(p.tree, { card: p.page === CARD_PAGE })
  const next = await tweakSection(ctx, { id: 'selection', type: CODE_SECTION, v: 1, props: { label: p.label, source } }, selectionAsk(p.tree, p.ids, p.instruction), p.key ?? p.page)
  const t = sectionTree(String(next.props.source ?? ''), p.page)
  if (!t?.ok) throw new Error('The AI could not make that change: its reply could not be opened in the visual editor')
  return { tree: t.tree, changed: changedIds(p.tree, t.tree) }
}
