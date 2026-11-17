// A page document: blocks by id plus their order, so the editor and the AI can patch one block without rewriting the
// page. A block may hold child blocks in named slots (columns, tabs). Props are typed by the block's definition.

export const DOC_SCHEMA_VERSION = 1

export interface BlockVisibility {
  /** ISO times; the block shows only inside the window. */
  from?: string | null
  to?: string | null
  hidden?: boolean
}

export interface Block<P = Record<string, unknown>> {
  id: string
  type: string
  /** The block definition's version the props were written for. */
  v: number
  props: P
  children?: Record<string, string[]>
  visibility?: BlockVisibility
  /** Desktop documents only: props overridden on tablet widths (responsive fields only). */
  tablet?: Partial<P>
}

export interface PageDoc {
  schemaVersion: number
  blocks: Record<string, Block>
  order: string[]
  settings?: Record<string, unknown>
}

export const emptyDoc = (): PageDoc => ({ schemaVersion: DOC_SCHEMA_VERSION, blocks: {}, order: [] })

const childIds = (b: Block) => Object.values(b.children ?? {}).flat()

/** Drops ids that point nowhere and blocks nothing reaches, so a hand-edited or merged doc stays consistent. */
export function normalizeDoc(doc: Partial<PageDoc> | null | undefined): PageDoc {
  const blocks = doc?.blocks && typeof doc.blocks === 'object' ? { ...doc.blocks } : {}
  for (const [id, b] of Object.entries(blocks)) {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string') delete blocks[id]
    else blocks[id] = { ...b, id, v: Number(b.v) || 1, props: b.props && typeof b.props === 'object' ? b.props : {} }
  }
  const seen = new Set<string>()
  const keep = (ids: unknown[]) =>
    ids.filter((id): id is string => typeof id === 'string' && !!blocks[id] && !seen.has(id) && (seen.add(id), true))
  const order = keep(Array.isArray(doc?.order) ? doc.order : [])
  for (const b of Object.values(blocks)) {
    if (b.children) b.children = Object.fromEntries(Object.entries(b.children).map(([slot, ids]) => [slot, keep(Array.isArray(ids) ? ids : [])]))
  }
  for (const id of Object.keys(blocks)) if (!seen.has(id)) delete blocks[id]
  return { schemaVersion: DOC_SCHEMA_VERSION, blocks, order, ...(doc?.settings ? { settings: doc.settings } : {}) }
}

/** Top-level blocks in order. */
export const topBlocks = (doc: PageDoc): Block[] => doc.order.map(id => doc.blocks[id]).filter(Boolean)

export function insertBlock(doc: PageDoc, block: Block, at = doc.order.length, parent?: { id: string; slot: string }): PageDoc {
  const blocks = { ...doc.blocks, [block.id]: block }
  if (parent) {
    const p = blocks[parent.id]
    if (!p) throw new Error(`No block ${parent.id}`)
    const list = [...(p.children?.[parent.slot] ?? [])]
    list.splice(Math.max(0, Math.min(at, list.length)), 0, block.id)
    blocks[parent.id] = { ...p, children: { ...p.children, [parent.slot]: list } }
    return { ...doc, blocks }
  }
  const order = [...doc.order]
  order.splice(Math.max(0, Math.min(at, order.length)), 0, block.id)
  return { ...doc, blocks, order }
}

export function removeBlock(doc: PageDoc, id: string): PageDoc {
  const gone = new Set<string>()
  const walk = (bid: string) => {
    const b = doc.blocks[bid]
    if (!b || gone.has(bid)) return
    gone.add(bid)
    childIds(b).forEach(walk)
  }
  walk(id)
  const blocks: Record<string, Block> = {}
  for (const [bid, b] of Object.entries(doc.blocks)) {
    if (gone.has(bid)) continue
    blocks[bid] = b.children
      ? { ...b, children: Object.fromEntries(Object.entries(b.children).map(([s, ids]) => [s, ids.filter(c => !gone.has(c))])) }
      : b
  }
  return { ...doc, blocks, order: doc.order.filter(o => !gone.has(o)) }
}

/** Where a block sits: the top level, or the parent and slot holding it; null when it is not on the page. */
export function blockPlace(doc: PageDoc, id: string): { parent?: { id: string; slot: string }; index: number } | null {
  const top = doc.order.indexOf(id)
  if (top >= 0) return { index: top }
  for (const b of Object.values(doc.blocks)) {
    for (const [slot, ids] of Object.entries(b.children ?? {})) {
      const i = ids.indexOf(id)
      if (i >= 0) return { parent: { id: b.id, slot }, index: i }
    }
  }
  return null
}

export function updateBlock(doc: PageDoc, id: string, patch: Partial<Omit<Block, 'id'>>): PageDoc {
  const b = doc.blocks[id]
  if (!b) throw new Error(`No block ${id}`)
  return { ...doc, blocks: { ...doc.blocks, [id]: { ...b, ...patch, id } } }
}

/**
 * Moves a block (keeping its own children) to `at` in the top level or in a parent's slot. `at` indexes the target list
 * without the block, so a move within one list matches arrayMove.
 */
export function moveBlock(doc: PageDoc, id: string, at: number, parent?: { id: string; slot: string }): PageDoc {
  const b = doc.blocks[id]
  if (!b) throw new Error(`No block ${id}`)
  if (parent) {
    const inside = new Set<string>()
    const walk = (bid: string) => {
      const x = doc.blocks[bid]
      if (!x || inside.has(bid)) return
      inside.add(bid)
      childIds(x).forEach(walk)
    }
    walk(id)
    if (inside.has(parent.id)) throw new Error('A block cannot go inside itself')
  }
  const blocks: Record<string, Block> = {}
  for (const [bid, x] of Object.entries(doc.blocks)) {
    blocks[bid] =
      x.children && childIds(x).includes(id)
        ? { ...x, children: Object.fromEntries(Object.entries(x.children).map(([s, ids]) => [s, ids.filter(c => c !== id)])) }
        : x
  }
  return insertBlock({ ...doc, blocks, order: doc.order.filter(o => o !== id) }, b, at, parent)
}

/** Reorders the top level; ids not listed keep their relative order after the listed ones. */
export function reorder(doc: PageDoc, ids: string[]): PageDoc {
  const listed = ids.filter(id => doc.order.includes(id))
  return { ...doc, order: [...new Set([...listed, ...doc.order.filter(id => !listed.includes(id))])] }
}

/** Whether a block shows at `now` (its window and hidden flag). */
export function blockVisible(b: Block, now = Date.now()): boolean {
  const v = b.visibility
  if (!v) return true
  if (v.hidden) return false
  if (v.from && Date.parse(v.from) > now) return false
  if (v.to && Date.parse(v.to) <= now) return false
  return true
}

/** Fresh ids for a copied doc (copying between layouts or from a template), keeping slot references intact. */
export function cloneDoc(doc: PageDoc, newId: () => string): PageDoc {
  const map = new Map(Object.keys(doc.blocks).map(id => [id, newId()]))
  const re = (id: string) => map.get(id) ?? id
  const blocks: Record<string, Block> = {}
  for (const b of Object.values(doc.blocks)) {
    const id = re(b.id)
    blocks[id] = {
      ...structuredClone(b),
      id,
      ...(b.children ? { children: Object.fromEntries(Object.entries(b.children).map(([s, ids]) => [s, ids.map(re)])) } : {}),
    }
  }
  return { ...doc, blocks, order: doc.order.map(re) }
}
