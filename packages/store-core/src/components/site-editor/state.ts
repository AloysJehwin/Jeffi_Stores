import type { Block, CodeNode, PageDoc } from '@jeffi/site-blocks'
import { DesignError, MAX_HISTORY, createHistory, endGesture, record, redo as redoTree, undo as undoTree, type DesignOp, type History } from '@jeffi/site-blocks/design'

// The visual editor's page: the document, a design history per code section (whose tree is the truth for that
// section), and one undo stack across them, so undo walks back edits in the order they were made whichever section
// or block list they touched. Pure: SiteEditor holds it in React state.

const CODE_SECTION = 'code_section'

/** A section's own edits, or a change to the page's block list (add, move, remove a section). */
type Entry = { block: string } | { before: PageDoc; after: PageDoc }

export interface EditorState {
  doc: PageDoc
  trees: Record<string, History>
  past: Entry[]
  future: Entry[]
  /** Counts changes, so a save knows whether more came in while it ran. */
  rev: number
}

/** What the canvas should show after an undo or redo: a section's operations, or a reload (a block-list change). */
export type Shown = { block: string; ops: DesignOp[] } | 'reload' | null

export const treeOf = (b: Block | undefined): CodeNode | null =>
  b?.type === CODE_SECTION && b.props?.tree && typeof b.props.tree === 'object' ? (b.props.tree as CodeNode) : null

/** A code section's tree as it is now; null for a classic block (one an undone conversion made classic again keeps its history aside). */
export const liveTree = (s: EditorState | null | undefined, block: string): CodeNode | null =>
  s && s.doc.blocks[block]?.type === CODE_SECTION ? (s.trees[block]?.tree ?? null) : null

export function createEditor(doc: PageDoc): EditorState {
  const trees: Record<string, History> = {}
  for (const b of Object.values(doc.blocks)) {
    const t = treeOf(b)
    if (t) trees[b.id] = createHistory(t)
  }
  return { doc, trees, past: [], future: [], rev: 0 }
}

const mapTrees = (trees: Record<string, History>, fn: (h: History, id: string) => History) => {
  const out: Record<string, History> = {}
  for (const [id, h] of Object.entries(trees)) out[id] = fn(h, id)
  return out
}

/** Ends every open gesture: the next edit is a step of its own. */
export const endGestures = (s: EditorState): EditorState => (Object.values(s.trees).some(h => h.open) ? { ...s, trees: mapTrees(s.trees, endGesture) } : s)

/**
 * Operations on one section's tree as one undoable step, or into its last step while `gesture` is still open (typing,
 * a drag). Throws DesignError, leaving the state as it was, when one doesn't apply.
 */
export function editSection(s: EditorState, block: string, ops: DesignOp[], gesture?: string): EditorState {
  const h = s.doc.blocks[block]?.type === CODE_SECTION ? s.trees[block] : undefined
  if (!h) throw new DesignError('That section has no tree to edit')
  const joins = !!gesture && h.open === gesture && h.past[h.past.length - 1]?.gesture === gesture
  const next = record(h, ops, gesture)
  if (next === h) return s
  const last = s.past[s.past.length - 1]
  const trees = mapTrees(s.trees, (x, id) => (id === block ? next : { ...endGesture(x), future: [] }))
  const past = joins && last && 'block' in last && last.block === block ? s.past : [...s.past, { block }].slice(-MAX_HISTORY)
  return { ...s, trees, past, future: [], rev: s.rev + 1 }
}

/**
 * A change to the page's blocks (order, sections added or removed), as one step. Code sections it adds get their own
 * history; the trees of those already there are never changed by it.
 */
export function editDoc(s: EditorState, fn: (doc: PageDoc) => PageDoc): EditorState {
  const after = fn(s.doc)
  if (after === s.doc) return s
  const trees = mapTrees(s.trees, h => ({ ...endGesture(h), future: [] }))
  for (const b of Object.values(after.blocks)) {
    const t = treeOf(b)
    // A section new to the page, or one a block became (a conversion), starts its own history.
    const became = t && s.doc.blocks[b.id] && s.doc.blocks[b.id].type !== b.type
    if (t && (!trees[b.id] || became)) trees[b.id] = createHistory(t)
  }
  return { ...s, doc: after, trees, past: [...s.past, { before: s.doc, after }].slice(-MAX_HISTORY), future: [], rev: s.rev + 1 }
}

export function undo(s: EditorState): { state: EditorState; shown: Shown } {
  let past = s.past
  while (past.length) {
    const e = past[past.length - 1]
    past = past.slice(0, -1)
    if ('before' in e) return { state: { ...endGestures(s), doc: e.before, past, future: [e, ...s.future], rev: s.rev + 1 }, shown: 'reload' }
    const h = s.trees[e.block]
    const step = h?.past[h.past.length - 1]
    // A section reloaded from the server has no steps left to undo.
    if (!h || !step) continue
    return {
      state: { ...s, trees: { ...mapTrees(s.trees, endGesture), [e.block]: undoTree(h) }, past, future: [e, ...s.future], rev: s.rev + 1 },
      shown: { block: e.block, ops: step.inverse },
    }
  }
  return { state: past === s.past ? s : { ...s, past }, shown: null }
}

export function redo(s: EditorState): { state: EditorState; shown: Shown } {
  let future = s.future
  while (future.length) {
    const [e, ...rest] = future
    future = rest
    if ('before' in e) return { state: { ...endGestures(s), doc: e.after, past: [...s.past, e], future, rev: s.rev + 1 }, shown: 'reload' }
    const h = s.trees[e.block]
    const step = h?.future[0]
    if (!h || !step) continue
    return {
      state: { ...s, trees: { ...mapTrees(s.trees, endGesture), [e.block]: redoTree(h) }, past: [...s.past, e], future, rev: s.rev + 1 },
      shown: { block: e.block, ops: step.ops },
    }
  }
  return { state: future === s.future ? s : { ...s, future }, shown: null }
}

export const canUndo = (s: EditorState) => s.past.length > 0
export const canRedo = (s: EditorState) => s.future.length > 0

/** The trees as they are now, by block. */
export const currentTrees = (s: EditorState): Record<string, CodeNode> =>
  Object.fromEntries(Object.keys(s.doc.blocks).filter(id => s.trees[id] && s.doc.blocks[id].type === CODE_SECTION).map(id => [id, s.trees[id].tree]))

/**
 * The document to save: each code section with its tree and an empty source, so the server prints and compiles the
 * tree (lib/site/code/compile.ts compileCodeProps); what it stores is always the compile's.
 */
export function docToSave(s: EditorState): PageDoc {
  const blocks: Record<string, Block> = {}
  for (const [id, b] of Object.entries(s.doc.blocks)) {
    // A block converted back by undo is a classic block again: its old history stays out of it.
    const h = b.type === CODE_SECTION ? s.trees[id] : undefined
    blocks[id] = h ? { ...b, props: { ...b.props, tree: h.tree, source: '' } } : b
  }
  return { ...s.doc, blocks }
}

const canon = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x))

/**
 * The saved document's trees taken in. A section still as it was sent whose saved tree differs (the compile settled
 * something the browser wrote differently) starts over from the saved tree; its earlier steps can't be undone.
 */
export function adoptSaved(s: EditorState, sent: Record<string, CodeNode>, saved: PageDoc): EditorState {
  let trees = s.trees
  for (const [id, tree] of Object.entries(sent)) {
    const h = trees[id]
    const t = treeOf(saved.blocks?.[id])
    if (!h || h.tree !== tree || !t || canon(t) === canon(tree)) continue
    trees = { ...trees, [id]: createHistory(t) }
  }
  return trees === s.trees ? s : { ...s, trees }
}

/**
 * A stock photo's credit kept with the page (`settings.credits`), for hosts whose pictures stay out of a gallery (a
 * Showcase's footer lists those the page still shows). Not an undo step; the next save carries it.
 */
export function addCredit(s: EditorState, image: string, credit: unknown): EditorState {
  if (!credit || typeof credit !== 'object') return s
  const list = Array.isArray(s.doc.settings?.credits) ? (s.doc.settings!.credits as { image: string }[]) : []
  const credits = [...list.filter(c => c?.image !== image), { image, credit }].slice(-40)
  return { ...s, doc: { ...s.doc, settings: { ...s.doc.settings, credits } }, rev: s.rev + 1 }
}
