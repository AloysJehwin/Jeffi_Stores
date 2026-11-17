import { normalizeDoc, type Block, type PageDoc } from './doc'

// Three-way merge of a draft into the live document it started from (base), block by block: a block only the draft
// changed takes the draft's version, one only live changed keeps live's, and one both changed differently takes the
// draft's and is reported. The order follows the draft when it reordered, else live; blocks added on the other side
// are kept.

const canonical = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x
  )
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

export function mergeDocs(base: PageDoc, live: PageDoc, draft: PageDoc): { doc: PageDoc; conflicts: string[] } {
  const conflicts: string[] = []
  const blocks: Record<string, Block> = {}
  const ids = new Set([...Object.keys(base.blocks), ...Object.keys(live.blocks), ...Object.keys(draft.blocks)])
  for (const id of ids) {
    const b = base.blocks[id]
    const l = live.blocks[id]
    const d = draft.blocks[id]
    const draftChanged = !same(b, d)
    const liveChanged = !same(b, l)
    let pick: Block | undefined
    if (!draftChanged) pick = l
    else if (!liveChanged || same(l, d)) pick = d
    else {
      conflicts.push(id)
      pick = d
    }
    if (pick) blocks[id] = pick
  }
  const draftReordered = !same(base.order, draft.order)
  const [first, second] = draftReordered ? [draft.order, live.order] : [live.order, draft.order]
  const nested = new Set(Object.values(blocks).flatMap(b => Object.values(b.children ?? {}).flat()))
  const order = [...new Set([...first, ...second])].filter(id => blocks[id] && !nested.has(id))
  return { doc: normalizeDoc({ ...draft, blocks, order }), conflicts }
}
