import { NODE_ID, isTagNode, type CodeNode, type CodeValue, type TagNode } from './code'

// The visual editor's edits to a code section's tree, as typed operations. Each applies to an immutable tree and
// returns its inverse, so a history can undo and redo them; a gesture (a drag, a stretch of typing) groups its
// operations into one step. Nothing here is trusted on the server: a saved tree is printed and compiled again there
// (store-core lib/site/code/compile.ts compileCodeProps).

/** Tailwind's responsive prefixes; the editor's breakpoints are Phone (base), Tablet (md) and Desktop (lg). */
export const BREAKPOINTS = ['base', 'sm', 'md', 'lg', 'xl', '2xl'] as const
export type Breakpoint = (typeof BREAKPOINTS)[number]
export const EDITOR_BREAKPOINTS: Breakpoint[] = ['base', 'md', 'lg']

export type Scalar = string | number | boolean | null

export type DesignOp =
  /** Text of a text node, or of an element holding only text. */
  | { op: 'text'; id: string; value: string }
  /** The classes of one breakpoint (whole tokens, `md:` included); the other breakpoints' are kept. */
  | { op: 'classes'; id: string; bp: Breakpoint; value: string[] }
  /** A literal attribute or prop; null removes it. Data-bound values can't be overwritten. */
  | { op: 'attr'; id: string; name: string; value: Scalar }
  /** A node into an element's children; it brings its own ids. */
  | { op: 'insert'; parent: string; index: number; node: CodeNode }
  /** Into `parent` before its child at `index` (counted before the node leaves its place). */
  | { op: 'move'; id: string; parent: string; index: number }
  /** A copy right after the node, with fresh ids; `as` is the copy's id (filled in when applied). */
  | { op: 'duplicate'; id: string; as?: string }
  | { op: 'remove'; id: string }
  /** Sibling nodes, in order, inside a new element. */
  | { op: 'wrap'; ids: string[]; wrapper: { id?: string; tag: string; props?: Record<string, CodeValue> } }
  /** An element replaced by its children. */
  | { op: 'unwrap'; id: string }
  /** One node replaced whole (a change on a selection). */
  | { op: 'node'; id: string; node: CodeNode }
  /** The whole tree (an AI change to the section). */
  | { op: 'replace'; tree: CodeNode }

export class DesignError extends Error {}

function fail(msg: string): never {
  throw new DesignError(msg)
}

// ── Class tokens by breakpoint ──────────────────────────────────────────────────────────────────

/** A token's variants, split on colons outside brackets (`md:[&>p]:mt-2` → md, [&>p]). */
export function classVariants(token: string): { variants: string[]; utility: string } {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  return { variants: parts, utility: token.slice(start) }
}

/** The breakpoint a token applies from; range variants (`max-md:`) belong to none of them. */
export function tokenBreakpoint(token: string): Breakpoint | 'other' {
  const { variants } = classVariants(token)
  const bp = variants.find(v => v !== 'base' && (BREAKPOINTS as readonly string[]).includes(v))
  if (bp) return bp as Breakpoint
  return variants.some(v => /^(max|min)-/.test(v)) ? 'other' : 'base'
}

export const splitTokens = (className: string) => className.split(/\s+/).filter(Boolean)

export const breakpointTokens = (className: string, bp: Breakpoint) => splitTokens(className).filter(t => tokenBreakpoint(t) === bp)

/**
 * The classes with one breakpoint's tokens replaced: the new ones take the place of its first old one, or else go in
 * before the first wider breakpoint's.
 */
export function withBreakpoint(className: string, bp: Breakpoint, tokens: string[]): string {
  const bad = tokens.find(t => !t || /\s/.test(t) || tokenBreakpoint(t) !== bp)
  if (bad !== undefined) fail(`"${bad}" isn't a ${bp} class`)
  const out: string[] = []
  let placed = false
  for (const t of splitTokens(className)) {
    if (tokenBreakpoint(t) !== bp) out.push(t)
    else if (!placed) {
      out.push(...tokens)
      placed = true
    }
  }
  if (!placed) {
    const rank = BREAKPOINTS.indexOf(bp)
    const at = out.findIndex(t => {
      const b = tokenBreakpoint(t)
      return b !== 'other' && BREAKPOINTS.indexOf(b) > rank
    })
    out.splice(at < 0 ? out.length : at, 0, ...tokens)
  }
  return out.join(' ')
}

// ── Finding nodes ───────────────────────────────────────────────────────────────────────────────

/** Path steps: a child index, or THEN / ELSE / BODY for a branch or a render / list body. */
const THEN = -1
const ELSE = -2
const BODY = -3
type Loc = { node: CodeNode; path: number[] }

const kidsOf = (n: CodeNode): CodeNode[] | null => (n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children : null)

function* walk(n: CodeNode, path: number[] = []): Generator<Loc> {
  yield { node: n, path }
  const kids = kidsOf(n)
  if (kids) for (let i = 0; i < kids.length; i++) yield* walk(kids[i], [...path, i])
  if (n.t === 'cmp' && n.render) yield* walk(n.render.body, [...path, BODY])
  if (n.t === 'each') yield* walk(n.body, [...path, BODY])
  if (n.t === 'cond') {
    yield* walk(n.then, [...path, THEN])
    if (n.else) yield* walk(n.else, [...path, ELSE])
  }
}

export function findNode(tree: CodeNode, id: string): Loc | null {
  for (const l of walk(tree)) if (l.node.id === id) return l
  return null
}
const need = (tree: CodeNode, id: string) => findNode(tree, id) ?? fail(`No node ${id}`)

/** Every id in a subtree. */
export const treeIds = (n: CodeNode) => [...walk(n)].map(l => l.node.id).filter((x): x is string => !!x)

function child(n: CodeNode, step: number): CodeNode {
  if (step >= 0) return kidsOf(n)?.[step] ?? fail('Bad path')
  if (n.t === 'cond' && step === THEN) return n.then
  if (n.t === 'cond' && step === ELSE && n.else) return n.else
  if (n.t === 'cmp' && n.render && step === BODY) return n.render.body
  if (n.t === 'each' && step === BODY) return n.body
  return fail('Bad path')
}

function withChild(n: CodeNode, step: number, c: CodeNode): CodeNode {
  if (step >= 0) return { ...n, children: kidsOf(n)!.map((x, i) => (i === step ? c : x)) } as CodeNode
  if (n.t === 'cond') return step === THEN ? { ...n, then: c } : { ...n, else: c }
  if (n.t === 'cmp' && n.render) return { ...n, render: { ...n.render, body: c } }
  return { ...(n as Extract<CodeNode, { t: 'each' }>), body: c }
}

/** The tree with the node at `path` replaced, sharing everything else. */
function update(tree: CodeNode, path: number[], fn: (n: CodeNode) => CodeNode): CodeNode {
  if (!path.length) return fn(tree)
  const [step, ...rest] = path
  return withChild(tree, step, update(child(tree, step), rest, fn))
}

/** A node's place in its parent's children. */
function placeOf(tree: CodeNode, id: string): { parent: CodeNode; parentPath: number[]; index: number } {
  const { path } = need(tree, id)
  const index = path[path.length - 1]
  if (index === undefined) fail("The section's root stays where it is")
  if (index < 0) fail('That node fills a slot (a branch, a render function): change what is inside it')
  const parentPath = path.slice(0, -1)
  let parent = tree
  for (const s of parentPath) parent = child(parent, s)
  return { parent, parentPath, index }
}

const setKids = (tree: CodeNode, path: number[], fn: (kids: CodeNode[]) => CodeNode[]) => update(tree, path, n => ({ ...n, children: fn(kidsOf(n)!) }) as CodeNode)

/** The `eN` after the highest taken, so an id removed earlier in the history isn't handed to another node. */
export function freshId(taken: Iterable<string>): string {
  let max = 0
  for (const id of taken) {
    const m = /^e(\d{1,9})$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `e${max + 1}`
}

/** A copy of a subtree under new ids: tags get the next free `eN` (the root `rootId` if given); ids derived from a
 * tag follow it; other derived ids get a `~n` suffix. */
function copyWithIds(n: CodeNode, taken: Set<string>, rootId?: string): CodeNode {
  const clone = structuredClone(n)
  const map = new Map<string, string>()
  for (const { node } of walk(clone))
    if (isTagNode(node)) {
      const id = node === clone && rootId ? rootId : freshId(taken)
      taken.add(id)
      if (node.id) map.set(node.id, id)
      node.id = id
    }
  for (const { node } of walk(clone)) {
    if (isTagNode(node) || !node.id) continue
    const [head, ...rest] = node.id.split('.')
    let id = map.has(head) ? [map.get(head), ...rest].join('.') : node.id
    for (let k = 1; taken.has(id); k++) id = `${node.id}~${k}`
    taken.add(id)
    node.id = id
  }
  return clone
}

const isLitString = (v: CodeValue | undefined): v is { k: 'lit'; v: string } => !!v && v.k === 'lit' && typeof v.v === 'string'
const hasLocked = (n: CodeNode) => [...walk(n)].some(l => isTagNode(l.node) && !!l.node.locked)
const BAD_ATTR = /^on|^(ref|key|style|dangerouslySetInnerHTML|data-e|srcSet|srcset|formAction|action)$/

// ── Applying ────────────────────────────────────────────────────────────────────────────────────

export interface Applied {
  tree: CodeNode
  /** Undoes it. */
  inverse: DesignOp
  /** The operation as it applied (a duplicate's copy id, a wrapper's id), so redo repeats it exactly. */
  op: DesignOp
}

function tag(tree: CodeNode, id: string): { node: TagNode; path: number[] } {
  const loc = need(tree, id)
  return isTagNode(loc.node) ? { node: loc.node, path: loc.path } : fail(`${id} isn't an element`)
}

function setProps(tree: CodeNode, id: string, fn: (p: Record<string, CodeValue>) => Record<string, CodeValue>): CodeNode {
  const { node, path } = tag(tree, id)
  return update(tree, path, () => ({ ...node, props: fn({ ...node.props }) }))
}

/** The node taken out of its parent (locked parts too: moving keeps them on the page). */
function detach(tree: CodeNode, id: string) {
  const { parent, parentPath, index } = placeOf(tree, id)
  const node = kidsOf(parent)![index]
  return { tree: setKids(tree, parentPath, k => k.filter((_, i) => i !== index)), node, parentId: parent.id ?? fail('Its parent has no id'), index }
}

function insertAt(tree: CodeNode, parentId: string, index: number, node: CodeNode): CodeNode {
  const { node: parent, path } = need(tree, parentId)
  const kids = kidsOf(parent) ?? fail(`${parentId} can't hold children`)
  if (!Number.isInteger(index) || index < 0 || index > kids.length) fail('Index out of range')
  return setKids(tree, path, k => [...k.slice(0, index), node, ...k.slice(index)])
}

export function applyOp(tree: CodeNode, op: DesignOp): Applied {
  switch (op.op) {
    case 'text': {
      if (typeof op.value !== 'string') fail('Text must be text')
      const { node: n, path } = need(tree, op.id)
      if (n.t === 'text') return { tree: update(tree, path, () => ({ ...n, value: op.value })), inverse: { op: 'text', id: op.id, value: n.value }, op }
      if (!isTagNode(n) || (n.t === 'cmp' && n.render) || n.children.some(c => c.t !== 'text')) return fail(`${op.id} holds more than text`)
      const kid: CodeNode = { t: 'text', value: op.value, id: n.children[0]?.id ?? `${n.id}.0` }
      const next = update(tree, path, () => ({ ...n, children: op.value ? [kid] : [] }))
      // One text child (or none) comes back as text; several come back as they were.
      const inverse: DesignOp = n.children.length <= 1 ? { op: 'text', id: op.id, value: n.children[0]?.t === 'text' ? n.children[0].value : '' } : { op: 'node', id: op.id, node: n }
      return { tree: next, inverse, op }
    }
    case 'classes': {
      const { node: n } = tag(tree, op.id)
      const cls = n.props.className
      if (cls && !isLitString(cls)) fail('These classes are built from data: change them in code')
      const old = cls ? (cls as { v: string }).v : null
      const next = withBreakpoint(old ?? '', op.bp, op.value)
      const t = setProps(tree, op.id, p => {
        if (next || old !== null) p.className = { k: 'lit', v: next }
        return p
      })
      return { tree: t, inverse: { op: 'attr', id: op.id, name: 'className', value: old }, op }
    }
    case 'attr': {
      if (BAD_ATTR.test(op.name) || !/^[A-Za-z][\w-]*$/.test(op.name)) fail(`${op.name} can't be set`)
      if (op.value !== null && !['string', 'number', 'boolean'].includes(typeof op.value)) fail('Attributes take text, numbers or true/false')
      const { node: n } = tag(tree, op.id)
      const cur = n.props[op.name]
      if (cur && cur.k !== 'lit') fail(`${op.name} comes from data: change it in code`)
      const t = setProps(tree, op.id, p => {
        if (op.value === null) delete p[op.name]
        else p[op.name] = { k: 'lit', v: op.value }
        return p
      })
      return { tree: t, inverse: { op: 'attr', id: op.id, name: op.name, value: cur ? (cur.v as Scalar) : null }, op }
    }
    case 'insert': {
      const id = op.node?.id ?? fail('A new node needs an id')
      if (isTagNode(op.node) && !NODE_ID.test(id)) fail(`${id} isn't a valid id`)
      const taken = new Set(treeIds(tree))
      const clash = treeIds(op.node).find(x => taken.has(x))
      if (clash) fail(`${clash} is taken`)
      return { tree: insertAt(tree, op.parent, op.index, op.node), inverse: { op: 'remove', id }, op }
    }
    case 'remove': {
      const d = detach(tree, op.id)
      if (hasLocked(d.node)) fail('This part is needed on the page')
      return { tree: d.tree, inverse: { op: 'insert', parent: d.parentId, index: d.index, node: d.node }, op }
    }
    case 'move': {
      const n = need(tree, op.id).node
      if (findNode(n, op.parent)) fail("A node can't go inside itself")
      const d = detach(tree, op.id)
      const same = d.parentId === op.parent
      const index = same && op.index > d.index ? op.index - 1 : op.index
      const next = insertAt(d.tree, op.parent, index, d.node)
      // Back to where it was, counted the way `index` is.
      const back = same && d.index > index ? d.index + 1 : d.index
      return { tree: next, inverse: { op: 'move', id: op.id, parent: d.parentId, index: back }, op }
    }
    case 'duplicate': {
      const n = need(tree, op.id).node
      if (hasLocked(n)) fail('This part can only appear once')
      const { parent, parentPath, index } = placeOf(tree, op.id)
      const taken = new Set(treeIds(tree))
      if (op.as !== undefined && (taken.has(op.as) || !NODE_ID.test(op.as) || !isTagNode(n))) fail(`${op.as} can't be the copy's id`)
      const copy = copyWithIds(n, taken, op.as)
      void parent
      return { tree: setKids(tree, parentPath, k => [...k.slice(0, index + 1), copy, ...k.slice(index + 1)]), inverse: { op: 'remove', id: copy.id! }, op: { ...op, as: copy.id } }
    }
    case 'wrap': {
      if (!op.ids.length) fail('Nothing to wrap')
      if (!/^[a-z][a-z0-9]*$/.test(op.wrapper.tag)) fail(`<${op.wrapper.tag}> isn't a tag`)
      const places = op.ids.map(id => placeOf(tree, id))
      const first = places[0]
      if (places.some((p, i) => p.parent !== first.parent || p.index !== first.index + i)) fail('Wrap siblings that sit next to each other, in order')
      const id = op.wrapper.id ?? freshId(treeIds(tree))
      if (!NODE_ID.test(id) || findNode(tree, id)) fail(`${id} can't be the wrapper's id`)
      const kids = kidsOf(first.parent)!
      const wrapper: CodeNode = { t: 'el', tag: op.wrapper.tag, props: { ...(op.wrapper.props ?? {}) }, children: kids.slice(first.index, first.index + op.ids.length), id }
      const next = setKids(tree, first.parentPath, k => [...k.slice(0, first.index), wrapper, ...k.slice(first.index + op.ids.length)])
      return { tree: next, inverse: { op: 'unwrap', id }, op: { ...op, wrapper: { ...op.wrapper, id } } }
    }
    case 'unwrap': {
      const { node: n } = tag(tree, op.id)
      if (n.t !== 'el') fail('Only an element can be unwrapped')
      if (!n.children.length) fail('Nothing inside to keep: remove it instead')
      const { parentPath, index } = placeOf(tree, op.id)
      const ids = n.children.map(c => c.id ?? fail('A child has no id'))
      const next = setKids(tree, parentPath, k => [...k.slice(0, index), ...n.children, ...k.slice(index + 1)])
      return { tree: next, inverse: { op: 'wrap', ids, wrapper: { id: n.id, tag: n.tag, props: n.props } }, op }
    }
    case 'node': {
      const { node: old, path } = need(tree, op.id)
      if (!op.node || typeof op.node !== 'object') fail('Not a node')
      const others = new Set(treeIds(tree).filter(x => !treeIds(old).includes(x)))
      const clash = treeIds(op.node).find(x => others.has(x))
      if (clash) fail(`${clash} is taken`)
      return { tree: update(tree, path, () => op.node), inverse: { op: 'node', id: op.node.id ?? fail('The node needs an id'), node: old }, op }
    }
    case 'replace':
      if (!op.tree || typeof op.tree !== 'object') fail('Not a tree')
      return { tree: op.tree, inverse: { op: 'replace', tree }, op }
    default:
      return fail('Unknown operation')
  }
}

/** Operations in order, with the inverse list that undoes them all. */
export function applyOps(tree: CodeNode, ops: DesignOp[]): { tree: CodeNode; inverse: DesignOp[]; ops: DesignOp[] } {
  let cur = tree
  const inverse: DesignOp[] = []
  const done: DesignOp[] = []
  for (const op of ops) {
    const r = applyOp(cur, op)
    cur = r.tree
    inverse.unshift(r.inverse)
    done.push(r.op)
  }
  return { tree: cur, inverse, ops: done }
}

// ── History ─────────────────────────────────────────────────────────────────────────────────────

export interface Step {
  ops: DesignOp[]
  inverse: DesignOp[]
  gesture?: string
}

export interface History {
  tree: CodeNode
  past: Step[]
  future: Step[]
  /** The gesture still open: operations recorded under it join the last step. */
  open: string | null
}

export const MAX_HISTORY = 200

export const createHistory = (tree: CodeNode): History => ({ tree, past: [], future: [], open: null })

/**
 * Operations as one undoable step, or into the last step while their gesture is the open one (typing, a drag).
 * Throws DesignError, leaving the history as it was, when one doesn't apply.
 */
export function record(h: History, ops: DesignOp[], gesture?: string): History {
  if (!ops.length) return h
  const r = applyOps(h.tree, ops)
  const last = h.past[h.past.length - 1]
  if (gesture && h.open === gesture && last?.gesture === gesture) {
    const merged: Step = { ops: [...last.ops, ...r.ops], inverse: [...r.inverse, ...last.inverse], gesture }
    return { tree: r.tree, past: [...h.past.slice(0, -1), merged], future: [], open: gesture }
  }
  const step: Step = { ops: r.ops, inverse: r.inverse, ...(gesture ? { gesture } : {}) }
  return { tree: r.tree, past: [...h.past, step].slice(-MAX_HISTORY), future: [], open: gesture ?? null }
}

/** Ends the open gesture: what comes next is a new step. */
export const endGesture = (h: History): History => (h.open ? { ...h, open: null } : h)

export function undo(h: History): History {
  const step = h.past[h.past.length - 1]
  if (!step) return h
  return { tree: applyOps(h.tree, step.inverse).tree, past: h.past.slice(0, -1), future: [step, ...h.future], open: null }
}

export function redo(h: History): History {
  const [step, ...rest] = h.future
  if (!step) return h
  return { tree: applyOps(h.tree, step.ops).tree, past: [...h.past, step], future: rest, open: null }
}

export const canUndo = (h: History) => h.past.length > 0
export const canRedo = (h: History) => h.future.length > 0
