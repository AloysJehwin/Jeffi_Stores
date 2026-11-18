import type { CodeNode, CodeValue } from './ast'

// A typed stand-in for a business detail the owner did not give ("Message us for today's hours", "In your
// neighbourhood") poses as a fact. On a Showcase page the renderer leaves out the row holding one whenever the detail
// is missing, so no page shows it whatever its code says; studioLint asks the model not to write them.

/** The <Business> fields a stand-in may pose as: when and where the business is, and how to reach it. */
export const BUSINESS_FACTS = new Set(['hours', 'address', 'fullAddress', 'location', 'city', 'state', 'pincode', 'phone', 'whatsapp', 'email'])

type Path = Extract<CodeValue, { k: 'path' }>
type El = Extract<CodeNode, { t: 'el' }>

const factPath = (v: CodeValue | undefined, params: ReadonlySet<string>): Path | null => {
  if (!v || typeof v !== 'object') return null
  if (v.k === 'bool') return factPath(v.v, params)
  return v.k === 'path' && params.has(v.root) && Array.isArray(v.path) && BUSINESS_FACTS.has(String(v.path[0])) ? v : null
}
const negated = (v: CodeValue | undefined, params: ReadonlySet<string>): Path | null => (v && v.k === 'not' ? factPath(v.v, params) : null)

const words = (s: unknown) => typeof s === 'string' && /[A-Za-z]{2}/.test(s)

/** Typed text only: no data, no link (a typed label on a link is the link's, not a stand-in). */
function staticText(n: CodeNode | undefined, depth = 0): boolean {
  if (!n || typeof n !== 'object' || depth > 30) return false
  switch (n.t) {
    case 'text':
      return words(n.value)
    case 'el':
      return n.tag !== 'a' && (n.children ?? []).some(c => staticText(c, depth + 1)) && (n.children ?? []).every(c => c.t === 'text' || (c.t === 'cmp' && c.name === 'Icon') || staticText(c, depth + 1))
    case 'frag':
      return (n.children ?? []).some(c => staticText(c, depth + 1)) && (n.children ?? []).every(c => c.t === 'text' || staticText(c, depth + 1))
    default:
      return false
  }
}
const staticValue = (v: CodeValue | undefined): boolean => !!v && ((v.k === 'lit' && words(v.v)) || (v.k === 'tpl' && v.parts.every(p => typeof p === 'string') && v.parts.some(words)))

/** The detail a value stands in for: `b.hours || "…"`, `b.hours ? b.hours : "…"`, `!b.hours ? "…" : …`. */
function standIn(v: CodeValue | undefined, params: ReadonlySet<string>): Path | null {
  if (!v || typeof v !== 'object') return null
  if (v.k === 'cond') return (factPath(v.test, params) && staticValue(v.else) ? factPath(v.test, params) : null) ?? (negated(v.test, params) && staticValue(v.then) ? negated(v.test, params) : null)
  if (v.k === 'tpl') for (const p of v.parts) if (typeof p !== 'string' && standIn(p, params)) return standIn(p, params)
  return null
}

/** The detail a node stands in for when it is missing, or null. */
function standInNode(n: CodeNode, params: ReadonlySet<string>): Path | null {
  if (n.t === 'expr') return standIn(n.value, params)
  if (n.t !== 'cond') return null
  const fact = factPath(n.test, params)
  if (fact && staticText(n.else)) return fact
  const not = negated(n.test, params)
  return not && staticText(n.then) ? not : null
}

const meaningful = (list: CodeNode[] | undefined) => (list ?? []).filter(c => !(c.t === 'text' && !c.value.trim())).length

// A row may go whole when it is small: a label, an icon and the detail, not a heading or the section's own content.
function small(n: El): boolean {
  let nodes = 0
  let ok = true
  const walk = (x: CodeNode | undefined) => {
    if (!x || !ok || typeof x !== 'object') return
    if (++nodes > 16) ok = false
    else if (x.t === 'el') {
      if (x.tag === 'h1' || x.tag === 'h2') ok = false
      else x.children?.forEach(walk)
    } else if (x.t === 'cmp') {
      if (x.name !== 'Icon') ok = false
    } else if (x.t === 'frag') x.children?.forEach(walk)
    else if (x.t === 'cond') (walk(x.then), walk(x.else))
    else if (x.t === 'each') ok = false
  }
  walk(n)
  return ok
}

/**
 * The rows of a section that show a typed stand-in for a missing business detail, each with the details it stands in
 * for: the stand-in's own element, or the small row around it (a label, an icon and the value), never past the
 * <Business> render function that binds the detail. Stand-ins inside a link are its label and stay.
 */
export function placeholderRows(ast: unknown): Map<object, Path[]> {
  const rows = new Map<object, Path[]>()
  const add = (row: object, fact: Path) => rows.set(row, [...(rows.get(row) ?? []), fact])
  // stack: the nodes from the nearest <Business> render body down to the current one.
  const walk = (n: unknown, params: ReadonlySet<string>, stack: CodeNode[], inLink: boolean, depth: number) => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    if (params.size && !inLink) {
      const fact = standInNode(node, params)
      if (fact) {
        const at = [...stack].reverse().findIndex(x => x.t === 'el')
        const own = at < 0 ? null : (stack[stack.length - 1 - at] as El)
        const parent = own ? stack[stack.length - 2 - at] : undefined
        // The element holding only the stand-in goes with its small row (a list item is a row itself); one holding more
        // goes when it is small itself.
        const row = !own ? node : meaningful(own.children) < 2 ? (own.tag !== 'li' && parent?.t === 'el' && small(parent) ? parent : own) : small(own) ? own : node
        add(row, fact)
        return
      }
    }
    const next = [...stack, node]
    switch (node.t) {
      case 'el':
        node.children?.forEach(c => walk(c, params, next, inLink || node.tag === 'a', depth + 1))
        return
      case 'cmp': {
        const link = inLink || node.name === 'Link'
        node.children?.forEach(c => walk(c, params, next, link, depth + 1))
        if (!node.render) return
        if (node.name === 'Business' && typeof node.render.param === 'string') walk(node.render.body, new Set([...params, node.render.param]), [], link, depth + 1)
        else walk(node.render.body, params, next, link, depth + 1)
        return
      }
      case 'frag':
        node.children?.forEach(c => walk(c, params, next, inLink, depth + 1))
        return
      case 'cond':
        walk(node.then, params, next, inLink, depth + 1)
        walk(node.else, params, next, inLink, depth + 1)
        return
      case 'each':
        walk(node.body, params, next, inLink, depth + 1)
        return
    }
  }
  walk(ast, new Set(), [], false, 0)
  return rows
}
