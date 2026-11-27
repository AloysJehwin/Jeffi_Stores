import { isTagNode, type CodeNode, type CodeValue } from '@jeffi/site-blocks'
import { EDITOR_BREAKPOINTS, cloneWithIds, findNode, treeIds, type DesignOp } from '@jeffi/site-blocks/design'
import { classOps, readClasses } from '@/lib/site/code/classes'
import { frameFor } from '@/lib/site/code/free'
import { litClass } from './free-ops'
import { hasLocked, insertPlace, isFrameNode, parentOf } from './nodes'

// The editor's clipboard: node subtrees copied or cut from a section, kept in memory and mirrored to sessionStorage so
// they survive the canvas reload and go to another section or page of the same editor session. A paste is an insert
// of copies under fresh ids (every descendant renewed); a pasted free layer keeps its placement classes.

const KEY = 'site-editor:clipboard'
let mem: CodeNode[] | null = null

const valid = (v: unknown): v is CodeNode[] => Array.isArray(v) && v.length > 0 && v.every(n => n && typeof n === 'object' && typeof (n as CodeNode).t === 'string')

export function readClip(): CodeNode[] | null {
  if (mem) return mem
  try {
    const raw = sessionStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    if (valid(v)) mem = v
  } catch {
    // Storage blocked: the clipboard stays in memory.
  }
  return mem
}

export function writeClip(nodes: CodeNode[]) {
  mem = structuredClone(nodes)
  try {
    sessionStorage.setItem(KEY, JSON.stringify(mem))
  } catch {
    // Too big or blocked: memory only.
  }
}

export function clearClip() {
  mem = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}

/** The nodes for `ids`, in tree order; null when one can't be copied (the section, a part the page has once). */
export function copyNodes(tree: CodeNode, ids: string[]): { nodes: CodeNode[] } | { error: string } {
  const set = new Set(ids)
  const order = treeIds(tree).filter(x => set.has(x))
  if (!order.length || set.has(tree.id ?? '')) return { error: 'Select an element to copy' }
  // A selected element inside another selected one comes with it.
  const found = order.map(id => findNode(tree, id)).filter((l): l is NonNullable<typeof l> => !!l)
  const nodes = found.filter(l => !found.some(o => o.node !== l.node && findNode(o.node, l.node.id!))).map(l => l.node)
  if (nodes.some(hasLocked)) return { error: 'This part can only appear once on the page' }
  return { nodes: structuredClone(nodes) }
}

const valueRoots = (v: CodeValue | undefined, out: Set<string>): void => {
  if (!v) return
  switch (v.k) {
    case 'path':
      return void out.add(v.root)
    case 'tpl':
      return v.parts.forEach(p => typeof p !== 'string' && valueRoots(p, out))
    case 'not':
    case 'bool':
      return valueRoots(v.v, out)
    case 'eq':
    case 'cmp':
      return valueRoots(v.a, out), valueRoots(v.b, out)
    case 'cond':
      return valueRoots(v.test, out), valueRoots(v.then, out), valueRoots(v.else, out)
    case 'obj':
      return Object.values(v.v).forEach(x => valueRoots(x, out))
    case 'arr':
      return v.v.forEach(x => valueRoots(x, out))
  }
}

/** The data names a subtree reads that nothing inside it binds (a render function's or a list's item). */
export function looseRoots(n: CodeNode, bound: string[] = [], out = new Set<string>()): Set<string> {
  const read = (v: CodeValue | undefined) => {
    const r = new Set<string>()
    valueRoots(v, r)
    r.forEach(x => !bound.includes(x) && out.add(x))
  }
  if (isTagNode(n)) Object.values(n.props).forEach(read)
  if (n.t === 'expr') read(n.value)
  if (n.t === 'cond') {
    read(n.test)
    looseRoots(n.then, bound, out)
    if (n.else) looseRoots(n.else, bound, out)
  }
  if (n.t === 'each') {
    read(n.items)
    looseRoots(n.body, [...bound, n.param, ...(n.index ? [n.index] : [])], out)
  }
  if (n.t === 'el' || n.t === 'cmp' || n.t === 'frag') n.children.forEach(c => looseRoots(c, bound, out))
  if (n.t === 'cmp' && n.render) looseRoots(n.render.body, [...bound, n.render.param, ...(n.render.index ? [n.render.index] : [])], out)
  return out
}

/** The names bound where a node sits: the render functions' and lists' items around it. */
function boundAt(n: CodeNode, id: string, bound: string[] = []): string[] | null {
  if (n.id === id) return bound
  const next: [CodeNode, string[]][] = []
  if (n.t === 'el' || n.t === 'cmp' || n.t === 'frag') n.children.forEach(c => next.push([c, bound]))
  if (n.t === 'cmp' && n.render) next.push([n.render.body, [...bound, n.render.param, ...(n.render.index ? [n.render.index] : [])]])
  if (n.t === 'each') next.push([n.body, [...bound, n.param, ...(n.index ? [n.index] : [])]])
  if (n.t === 'cond') next.push([n.then, bound], ...(n.else ? [[n.else, bound] as [CodeNode, string[]]] : []))
  for (const [c, b] of next) {
    const r = boundAt(c, id, b)
    if (r) return r
  }
  return null
}

/** Whether a placement class sits on the element at any editor breakpoint. */
const placedAnywhere = (cls: string) => EDITOR_BREAKPOINTS.some(b => readClasses(cls).values[b].position === 'absolute')

/**
 * The operations that paste `nodes` as copies: inside the selected element when it is a frame (a box, a group, the
 * section), else right after the last selected one, else at the end of the section. Refused (with the reason) for parts
 * the page has once, and for parts reading data the target doesn't have.
 */
export function pasteOps(tree: CodeNode, nodes: CodeNode[], selected: string | null): { ops: DesignOp[]; ids: string[] } | { error: string } {
  if (!nodes.length) return { error: 'Nothing copied yet' }
  if (nodes.some(hasLocked)) return { error: 'This part can only appear once on the page' }
  const at = selected ? findNode(tree, selected)?.node : tree
  if (!at) return { error: 'Select where to paste' }
  const into = at.t === 'el' && isFrameNode(at) && at.id ? { parent: at.id, index: at.children.length } : insertPlace(tree, selected)
  if (!into) return { error: 'Select an element beside where it should go' }
  const scope = boundAt(tree, into.parent) ?? []
  const loose = nodes.flatMap(n => [...looseRoots(n)]).filter(r => !scope.includes(r))
  if (loose.length) return { error: 'This part shows store data from where it was copied: paste it inside the same list' }
  const taken = new Set(treeIds(tree))
  const copies = nodes.map(n => cloneWithIds(n, taken))
  const ops: DesignOp[] = copies.map((node, i) => ({ op: 'insert', parent: into.parent, index: into.index + i, node }))
  // A pasted free layer needs a positioned frame: the nearest positioned ancestor, else the section.
  const free = copies.some(c => isTagNode(c) && c.props.className?.k === 'lit' && typeof c.props.className.v === 'string' && placedAnywhere(c.props.className.v))
  if (free && tree.id) {
    let positioned = false
    for (let up: string | null = into.parent; up && !positioned; up = parentOf(tree, up)?.parent.id ?? null) {
      const cls = litClass(tree, up)
      positioned = cls !== null && EDITOR_BREAKPOINTS.some(b => readClasses(cls).values[b].position !== undefined)
    }
    const root = litClass(tree, tree.id)
    if (!positioned && root !== null) ops.push(...classOps(tree.id, root, frameFor(root, 'lg', null)))
  }
  return { ops, ids: copies.map(c => c.id!) }
}
