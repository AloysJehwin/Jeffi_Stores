import { isTagNode, type CodeNode } from '@jeffi/site-blocks'
import { EDITOR_BREAKPOINTS, findNode, freshId, treeIds, type Breakpoint, type DesignOp } from '@jeffi/site-blocks/design'
import { groupBox, ungroupBox, type ArrangeRect } from '@/lib/site/code/arrange'
import { placeFree, type FreeRect } from '@/lib/site/code/free'
import { layerAt, placeOps } from './free-ops'
import { parentOf } from './nodes'

// Group and ungroup, composed from the design operations that exist: `wrap` and `unwrap`, plus the classes that place
// the group and its members. Free layers (placed at the breakpoint being edited) group into a free layer whose box is
// their union, each member re-placed in % of it; ungroup puts them back in % of the group's frame. One call, one undo step.

export type Box = Omit<ArrangeRect, 'id'>
export type Failure = { error: string }

const lit = (v: string) => ({ k: 'lit' as const, v })
const rank = (bp: Breakpoint) => EDITOR_BREAKPOINTS.indexOf(bp)
const wider = (bp: Breakpoint) => EDITOR_BREAKPOINTS.filter(b => rank(b) > rank(bp))

/** The selected elements, in tree order, when they are siblings that sit next to each other. */
export function groupable(tree: CodeNode, ids: string[]): { ids: string[] } | Failure {
  const uniq = [...new Set(ids)]
  if (uniq.length < 2) return { error: 'Select two or more elements to group' }
  const places = uniq.map(id => ({ id, at: id === tree.id ? null : parentOf(tree, id) }))
  const first = places[0].at
  if (places.some(p => !p.at || p.at.parent.id !== first?.parent.id)) return { error: 'Group elements that sit in the same place of the page' }
  const sorted = places.sort((a, b) => a.at!.index - b.at!.index)
  if (sorted.some((p, i) => p.at!.index !== sorted[0].at!.index + i)) return { error: 'Group elements that sit next to each other in the layers' }
  return { ids: sorted.map(p => p.id) }
}

/** Whether all of them are free layers at the breakpoint (then grouping needs their measured boxes). */
export const allFree = (tree: CodeNode, ids: string[], bp: Breakpoint) => ids.every(id => !!layerAt(tree, id, bp))

/**
 * The operations that group `ids` (as `groupable` ordered them) in a new `div`. When every member is a free layer at
 * `bp`, pass `boxes`: their boxes in % of their frame, as the canvas measures them.
 */
export function groupOps(tree: CodeNode, ids: string[], bp: Breakpoint, boxes: Map<string, Box> | null): DesignOp[] | Failure {
  const id = freshId(treeIds(tree))
  if (!allFree(tree, ids, bp)) return [{ op: 'wrap', ids, wrapper: { id, tag: 'div', props: { role: lit('group') } } }]
  if (!boxes || ids.some(m => !boxes.has(m))) return { error: 'Show those layers on the canvas first' }
  const { group, inside } = groupBox(ids.map(m => ({ id: m, box: boxes.get(m)! })))
  const layers = ids.map(m => layerAt(tree, m, bp)!)
  const z = Math.max(...layers.map(l => l.z))
  const rect: FreeRect = group
  let cls = placeFree('', bp, rect, z)
  // Wider screens that took the members' placement from this one take the group's too.
  for (const b of wider(bp)) {
    if (!ids.every(m => { const l = layerAt(tree, m, b); return !!l && rank(l.from) <= rank(bp) })) break
    cls = placeFree(cls, b, rect, z)
  }
  const ops: DesignOp[] = [{ op: 'wrap', ids, wrapper: { id, tag: 'div', props: { className: lit(cls), role: lit('group') } } }]
  inside.forEach((m, i) => {
    const had = layers[i].rect.height !== undefined
    ops.push(...placeOps(tree, m.id, bp, { left: m.left, top: m.top, width: m.width, ...(had ? { height: m.height } : {}) }, { z: layers[i].z }))
  })
  return ops
}

/** Whether the element can be ungrouped: a box with elements inside, not the section or a part the page needs. */
export function canUngroup(tree: CodeNode, id: string): boolean {
  const n = findNode(tree, id)?.node
  return !!n && id !== tree.id && n.t === 'el' && n.tag === 'div' && !n.locked && n.children.some(isTagNode) && parentOf(tree, id) !== null
}

/**
 * The operations that put a group's members back in its place. When the group is a free layer at `bp`, pass `box`: its
 * box in % of its frame, as the canvas measures it; free members go back in % of that frame.
 */
export function ungroupOps(tree: CodeNode, id: string, bp: Breakpoint, box: Box | null): DesignOp[] | Failure {
  const n = findNode(tree, id)?.node
  if (!n || n.t !== 'el' || !canUngroup(tree, id)) return { error: "That can't be ungrouped" }
  const own = layerAt(tree, id, bp)
  const ops: DesignOp[] = [{ op: 'unwrap', id }]
  if (!own) return ops
  if (own.rotate) return { error: "Reset the group's rotation before ungrouping it" }
  if (!box) return { error: 'Show that group on the canvas first' }
  const members = n.children.filter(isTagNode).filter(c => c.id && layerAt(tree, c.id, bp))
  const inside: ArrangeRect[] = members.map(c => {
    const r = layerAt(tree, c.id!, bp)!.rect
    return { id: c.id!, left: r.left, top: r.top, width: r.width, height: r.height ?? 0 }
  })
  ungroupBox(box, inside).forEach(m => {
    const layer = layerAt(tree, m.id, bp)!
    const rect: FreeRect = { left: m.left, top: m.top, width: m.width, ...(layer.rect.height !== undefined ? { height: m.height } : {}) }
    ops.push(...placeOps(tree, m.id, bp, rect, { z: Math.min(50, own.z + layer.z) }))
  })
  return ops
}
