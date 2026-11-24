import { NODE_ID, isTagNode, type CodeNode, type CodeValue } from '@jeffi/site-blocks'
import { MAX_EACH } from './allow'
import { evalValue, toText, truthy } from './evaluate'

// The compile's ids mode (checkSection with `ids`): the tree the visual editor edits. Every value that has one value
// whatever renders it is written out (consts are already inlined by the compile), `.map` over a literal list is
// unrolled into explicit nodes so each item is editable, every node gets a stable id (tags keep their `data-e`), and
// classNames built from expressions are marked read-only. Values are folded the way the interpreter would read them,
// and nodes are never folded away, so the section renders as before.

type Vars = ReadonlyMap<string, unknown>
type Lit = Extract<CodeValue, { k: 'lit' }>['v']
const NONE: Vars = new Map()

export interface CanonOptions {
  /** Unroll `.map` over literal lists (off when the unrolled section would not fit the limits). */
  unroll: boolean
  /** Parts the page can't lose (marked `locked`). */
  locked: (name: string) => boolean
}

const lit = (v: unknown): CodeValue => ({ k: 'lit', v: (v === undefined ? null : v) as Lit })

/** Every path in `v` reads a name bound in `vars`, so it has one value. */
function closed(v: CodeValue, vars: Vars): boolean {
  switch (v.k) {
    case 'lit':
      return true
    case 'path':
      return vars.has(v.root)
    case 'tpl':
      return v.parts.every(p => typeof p === 'string' || closed(p, vars))
    case 'not':
    case 'bool':
      return closed(v.v, vars)
    case 'eq':
    case 'cmp':
      return closed(v.a, vars) && closed(v.b, vars)
    case 'cond':
      return closed(v.test, vars) && closed(v.then, vars) && closed(v.else, vars)
    case 'obj':
      return Object.values(v.v).every(x => closed(x, vars))
    case 'arr':
      return v.v.every(x => closed(x, vars))
    default:
      return false
  }
}

/** A value with what it can be written out to. */
function fold(v: CodeValue, vars: Vars): CodeValue {
  if (closed(v, vars)) return lit(evalValue(v, vars))
  switch (v.k) {
    case 'tpl': {
      const parts: (string | CodeValue)[] = []
      for (const p of v.parts) {
        const x = typeof p === 'string' ? p : closed(p, vars) ? toText(evalValue(p, vars)) : fold(p, vars)
        if (typeof x === 'string') {
          if (!x) continue
          if (typeof parts[parts.length - 1] === 'string') parts[parts.length - 1] += x
          else parts.push(x)
        } else parts.push(x)
      }
      return { k: 'tpl', parts }
    }
    case 'not':
    case 'bool':
      return { k: v.k, v: fold(v.v, vars) }
    case 'eq':
      return { k: 'eq', a: fold(v.a, vars), b: fold(v.b, vars) }
    case 'cmp':
      return { k: 'cmp', op: v.op, a: fold(v.a, vars), b: fold(v.b, vars) }
    case 'cond':
      return { k: 'cond', test: fold(v.test, vars), then: fold(v.then, vars), else: fold(v.else, vars) }
    case 'obj':
      return { k: 'obj', v: Object.fromEntries(Object.entries(v.v).map(([k, x]) => [k, fold(x, vars)])) }
    case 'arr':
      return { k: 'arr', v: v.v.map(x => fold(x, vars)) }
    default:
      return { ...v }
  }
}

/** Props: a value that reads as nothing is left out (as the interpreter skips an undefined attribute or prop). */
function props(src: Record<string, CodeValue>, vars: Vars): Record<string, CodeValue> {
  const out: Record<string, CodeValue> = {}
  for (const [k, v] of Object.entries(src ?? {})) {
    if (k.endsWith('ClassName') || k === 'className') out[k] = closed(v, vars) ? lit(toText(evalValue(v, vars))) : fold(v, vars)
    else if (!closed(v, vars)) out[k] = fold(v, vars)
    else {
      const x = evalValue(v, vars)
      if (x !== undefined) out[k] = lit(x)
    }
  }
  return out
}

const without = (vars: Vars, ...names: (string | undefined)[]): Vars => {
  if (!names.some(n => n && vars.has(n))) return vars
  const next = new Map(vars)
  for (const n of names) if (n) next.delete(n)
  return next
}
const one = (list: CodeNode[]): CodeNode => (list.length === 1 ? list[0] : { t: 'frag', children: list })

function walk(n: CodeNode, vars: Vars, o: CanonOptions): CodeNode[] {
  switch (n.t) {
    case 'text':
      return [{ t: 'text', value: n.value }]
    case 'expr': {
      if (!closed(n.value, vars)) return [{ t: 'expr', value: fold(n.value, vars) }]
      // A value fixed whatever renders it is written-out words (an unrolled card's title), editable as text.
      const s = toText(evalValue(n.value, vars))
      return [s ? { t: 'text', value: s } : { t: 'expr', value: lit(s) }]
    }
    case 'cond': {
      const out: CodeNode = { t: 'cond', test: closed(n.test, vars) ? lit(truthy(evalValue(n.test, vars))) : fold(n.test, vars), then: one(walk(n.then, vars, o)) }
      if (n.else) out.else = one(walk(n.else, vars, o))
      return [out]
    }
    case 'frag':
      return [{ t: 'frag', children: n.children.flatMap(c => walk(c, vars, o)) }]
    case 'el':
      return [{ t: 'el', tag: n.tag, props: props(n.props, vars), children: n.children.flatMap(c => walk(c, vars, o)), ...(n.id ? { id: n.id } : {}) }]
    case 'cmp': {
      const out: CodeNode = { t: 'cmp', name: n.name, props: props(n.props, vars), children: n.children.flatMap(c => walk(c, vars, o)), ...(n.id ? { id: n.id } : {}) }
      if (n.render) {
        const inner = without(vars, n.render.param, n.render.index)
        out.render = { param: n.render.param, ...(n.render.index ? { index: n.render.index } : {}), body: one(walk(n.render.body, inner, o)) }
      }
      return [out]
    }
    case 'each': {
      const inner = without(vars, n.param, n.index)
      if (!closed(n.items, vars)) return [{ t: 'each', items: fold(n.items, vars), param: n.param, ...(n.index ? { index: n.index } : {}), body: one(walk(n.body, inner, o)) }]
      const items = evalValue(n.items, vars)
      // The interpreter draws nothing for a list that isn't one.
      if (!Array.isArray(items)) return []
      if (!o.unroll) return [{ t: 'each', items: lit(items), param: n.param, ...(n.index ? { index: n.index } : {}), body: one(walk(n.body, inner, o)) }]
      return items.slice(0, MAX_EACH).flatMap((item, i) => {
        const bound = new Map(inner)
        bound.set(n.param, item)
        if (n.index) bound.set(n.index, i)
        return walk(n.body, bound, o)
      })
    }
    default:
      return []
  }
}

/** The nodes under `n`, in document order, with the slot each sits in. */
function slots(n: CodeNode): [CodeNode, string][] {
  switch (n.t) {
    case 'el':
    case 'frag':
      return n.children.map((c, i) => [c, String(i)])
    case 'cmp':
      return [...n.children.map((c, i): [CodeNode, string] => [c, String(i)]), ...(n.render ? [[n.render.body, 'r'] as [CodeNode, string]] : [])]
    case 'cond':
      return [[n.then, 't'], ...(n.else ? [[n.else, 'e'] as [CodeNode, string]] : [])]
    case 'each':
      return [[n.body, 'b']]
    default:
      return []
  }
}

export function visitTree(n: CodeNode, fn: (n: CodeNode) => void): void {
  fn(n)
  for (const [c] of slots(n)) visitTree(c, fn)
}

/** The ids: a tag keeps its `data-e` (the first one, when copies share it), others get the next free `eN`; nodes
 * without a tag take their place under the nearest node (`e3.1`, `e3.2.t`). */
function assignIds(root: CodeNode, o: CanonOptions): void {
  const used = new Set<string>()
  visitTree(root, n => {
    if (!isTagNode(n)) return
    if (n.id && NODE_ID.test(n.id) && !used.has(n.id)) used.add(n.id)
    else delete n.id
  })
  let next = 0
  const fresh = () => {
    let id: string
    do id = `e${++next}`
    while (used.has(id))
    used.add(id)
    return id
  }
  const go = (n: CodeNode, at: string) => {
    if (isTagNode(n)) {
      n.id ??= fresh()
      const cls = n.props.className
      if (cls && !(cls.k === 'lit' && typeof cls.v === 'string')) n.ro = true
      if (n.t === 'cmp' && o.locked(n.name)) n.locked = true
    } else n.id = at
    for (const [c, slot] of slots(n)) go(c, `${n.id}.${slot}`)
  }
  go(root, 'r')
}

/** The ids-mode tree from a compiled AST (which it doesn't change). */
export function canonTree(ast: CodeNode, o: CanonOptions): CodeNode {
  const root = one(walk(ast, NONE, o))
  assignIds(root, o)
  return root
}

/** The tree without what the ids mode adds beyond the compile (derived ids, read-only and locked marks). */
export function stripTree(n: CodeNode): CodeNode {
  const out = structuredClone(n)
  visitTree(out, x => {
    if (isTagNode(x)) {
      delete x.ro
      delete x.locked
    } else delete x.id
  })
  return out
}
