import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import { visitTree } from '../code/ids'

// "Keep my words" (docs/plans/SITE_EDITOR_PLAN.md phase 4): when a page the owner changed by hand is designed again,
// the words they wrote go to the AI with the brief (StudioBrief.keepWords), to be reused where they fit.

const MAX_WORDS = 40
const MAX_CHARS = 1800

/** The words on a page's code sections, in order: each heading, line and button once, within a budget. */
export function pageWords(doc: PageDoc | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let chars = 0
  for (const id of doc?.order ?? []) {
    const b = doc?.blocks?.[id]
    if (b?.type !== 'code_section' || b.visibility?.hidden) continue
    const tree = (b.props?.tree ?? (b.props?.compiled as { ast?: unknown } | null)?.ast) as CodeNode | undefined
    if (!tree || typeof tree !== 'object') continue
    visitTree(tree, n => {
      if (n.t !== 'text') return
      const w = n.value.replace(/\s+/g, ' ').trim()
      if (w.length < 2 || !/[\p{L}]/u.test(w) || seen.has(w.toLowerCase()) || out.length >= MAX_WORDS || chars + w.length > MAX_CHARS) return
      seen.add(w.toLowerCase())
      chars += w.length
      out.push(w)
    })
  }
  return out
}

/** Whether a page was changed in the visual editor: its code sections carry the editor's trees. */
export const handEdited = (doc: PageDoc | null | undefined) => Object.values(doc?.blocks ?? {}).some(b => b?.type === 'code_section' && !!b.props?.tree)
