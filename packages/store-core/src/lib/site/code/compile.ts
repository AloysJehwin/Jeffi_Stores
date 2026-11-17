import { parse } from '@babel/parser'
import type * as t from '@babel/types'
import type { PageDoc, PageKey } from '@jeffi/site-blocks'
import { CARD_PAGE, CARD_PRODUCT, type CodeNode, type CodeValue } from './ast'
import {
  BLOCKED_TAGS,
  FORBIDDEN_KEYS,
  HTML_TAGS,
  LIBRARY_MODULE,
  LIBRARY_MODULES,
  MAX_CLASSES,
  MAX_DEPTH,
  MAX_NODES,
  MAX_SOURCE_BYTES,
  VOID_TAGS,
  attrAllowed,
  safeClass,
  safeHref,
  safeSrc,
  splitClasses,
} from './allow'
import { allowedOnPage, codeLibrary } from './library'
import type { CodeComponentDef } from './registry'
import { PRODUCT_FIELDS } from './parts/common'
import { cardScope, compileSectionCss } from './css'
import { coreBlockFor } from '../blocks'

// A code section's TSX checked against the allowlist and turned into a JSON AST. Nothing here runs the code: Babel
// parses it, and every construct is either translated into the AST or reported. Issues carry the line and what to
// change, so they can go straight back to the AI for a repair.

export interface CompiledSection {
  /** Scope id: the section renders inside `data-code-section="<id>"` and its CSS is scoped to it. */
  id: string
  ast: CodeNode
  classes: string[]
  css: string
  components: string[]
}
export interface CompileIssue {
  message: string
  line?: number
}
export type CompileResult = { ok: true; section: CompiledSection } | { ok: false; issues: CompileIssue[] }

/** Components a page holds exactly once (and never conditionally or in a list). */
export const ONCE_COMPONENTS = new Set(['PaymentStep'])
const DATA_LISTS = new Set(['Products', 'Categories', 'Brands', 'Reviews', 'Offers', 'SubCategories', 'AllCategories', 'AllBrands'])
const SLIDERS = new Set(['Carousel', 'Marquee'])
const MAX_ISSUES = 25

type Binding = { root: string; prefix: string[]; fields: Set<string> | null; label: string }
type Scope = Map<string, Binding>

interface Ctx {
  page: PageKey | null
  lib: Map<string, CodeComponentDef>
  issues: CompileIssue[]
  classes: Set<string>
  components: Set<string>
  consts: Map<string, CodeValue>
  nodes: number
  uid: number
  once: Map<string, number>
  capped: Set<string>
}

const lit = (v: Extract<CodeValue, { k: 'lit' }>['v']): CodeValue => ({ k: 'lit', v })
const isLit = (v: CodeValue): v is Extract<CodeValue, { k: 'lit' }> => v.k === 'lit'
const empty: CodeNode = { t: 'frag', children: [] }

function issue(ctx: Ctx, node: t.Node | null | undefined, message: string) {
  const line = node?.loc?.start.line
  if (ctx.issues.length >= MAX_ISSUES || ctx.issues.some(i => i.message === message && i.line === line)) return
  ctx.issues.push(line ? { message, line } : { message })
}
function capIssue(ctx: Ctx, key: string, node: t.Node, message: string) {
  if (ctx.capped.has(key)) return
  ctx.capped.add(key)
  issue(ctx, node, message)
}

function unwrap(e: t.Node): t.Node {
  let n = e
  while (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSNonNullExpression' || n.type === 'TSTypeAssertion' || n.type === 'ParenthesizedExpression')
    n = (n as t.TSAsExpression).expression
  return n
}

const KNOWN_METHODS = new Set(['toFixed', 'toLocaleString', 'toString', 'toUpperCase', 'toLowerCase', 'slice', 'substring', 'substr', 'join', 'split', 'filter', 'find', 'reduce', 'replace', 'trim', 'concat', 'includes', 'sort', 'reverse', 'padStart', 'charAt', 'some', 'every', 'flatMap', 'forEach', 'indexOf'])
function callMessage(e: t.CallExpression | t.OptionalCallExpression | t.NewExpression): string {
  const c = e.callee
  let root: t.Node = c
  while (root.type === 'MemberExpression' || root.type === 'OptionalMemberExpression' || root.type === 'CallExpression' || root.type === 'NewExpression')
    root = root.type === 'CallExpression' || root.type === 'NewExpression' ? root.callee : root.object
  if (root.type === 'Identifier' && root.name === 'Date') return "Date isn't available: use the year from <Store> (s => s.year)"
  if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && !c.computed && c.property.type === 'Identifier') {
    const m = c.property.name
    if (m === 'map') return 'LIST.map(item => <…/>) is only allowed where JSX goes, with one arrow function'
    if (KNOWN_METHODS.has(m)) return `Calls like .${m}() aren't allowed: use fields as they come (prices are pre-formatted: p.price.formatted) and write text out`
  }
  if (c.type === 'Identifier' && /^(String|Number|Math|JSON|Object|Array|parseInt|parseFloat|encodeURIComponent|fetch|eval|Function|setTimeout|require)$/.test(c.name))
    return `${c.name} isn't available: function calls aren't allowed`
  return "Function calls aren't allowed (the only call allowed is LIST.map(item => <…/>) where JSX goes)"
}

/** A property name from a member expression step, or null with an issue. */
function memberKey(ctx: Ctx, m: t.MemberExpression | t.OptionalMemberExpression): string | null {
  const p = m.property
  let key: string | null = null
  if (!m.computed && p.type === 'Identifier') key = p.name
  else if (m.computed && p.type === 'NumericLiteral' && Number.isInteger(p.value) && p.value >= 0) key = String(p.value)
  else if (m.computed && p.type === 'StringLiteral') key = p.value
  else {
    issue(ctx, m, 'Computed access like x[y] isn\'t allowed: use x.field or x[0]')
    return null
  }
  if (FORBIDDEN_KEYS.has(key)) {
    issue(ctx, m, `"${key}" can't be accessed`)
    return null
  }
  return key
}

/** A static lookup into a literal (a const). */
function litLookup(v: unknown, path: string[]): unknown {
  let cur = v
  for (const k of path) {
    if (cur == null) return null
    if (Array.isArray(cur)) cur = k === 'length' ? cur.length : /^\d+$/.test(k) ? cur[Number(k)] : undefined
    else if (typeof cur === 'string') cur = k === 'length' ? cur.length : undefined
    else if (typeof cur === 'object') cur = Object.prototype.hasOwnProperty.call(cur, k) ? (cur as Record<string, unknown>)[k] : undefined
    else cur = undefined
  }
  return cur === undefined ? null : cur
}

function value(ctx: Ctx, raw: t.Node, scope: Scope): CodeValue {
  const e = unwrap(raw)
  switch (e.type) {
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return lit(e.value)
    case 'NullLiteral':
      return lit(null)
    case 'TemplateLiteral': {
      if (e.quasis.some(q => q.value.cooked == null)) {
        issue(ctx, e, 'Invalid escape in a template literal')
        return lit('')
      }
      if (!e.expressions.length) return lit(e.quasis[0].value.cooked ?? '')
      const parts: (string | CodeValue)[] = []
      e.quasis.forEach((q, i) => {
        if (q.value.cooked) parts.push(q.value.cooked)
        const x = e.expressions[i]
        if (x) parts.push(value(ctx, x, scope))
      })
      return { k: 'tpl', parts }
    }
    case 'Identifier': {
      if (e.name === 'undefined') return lit(null)
      const b = scope.get(e.name)
      if (b) return { k: 'path', root: b.root, path: [...b.prefix] }
      const c = ctx.consts.get(e.name)
      if (c) return c
      issue(ctx, e, `Unknown name "${e.name}": only render-function parameters (p in {p => …}) and consts holding literals can be used`)
      return lit(null)
    }
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const keys: string[] = []
      let obj: t.Node = e
      while (obj.type === 'MemberExpression' || obj.type === 'OptionalMemberExpression') {
        const k = memberKey(ctx, obj)
        if (k == null) return lit(null)
        keys.unshift(k)
        obj = unwrap(obj.object)
      }
      if (obj.type !== 'Identifier') {
        issue(ctx, obj, obj.type === 'ThisExpression' ? "`this` isn't allowed" : 'Only fields of a render-function parameter can be read (p.name)')
        return lit(null)
      }
      const b = scope.get(obj.name)
      if (b) {
        if (b.fields && !b.prefix.length && !b.fields.has(keys[0])) {
          issue(ctx, e, `${b.label} has no field "${keys[0]}". Fields: ${[...b.fields].join(', ') || 'none'}`)
          return lit(null)
        }
        return { k: 'path', root: b.root, path: [...b.prefix, ...keys] }
      }
      const c = ctx.consts.get(obj.name)
      if (c && isLit(c)) {
        const v = litLookup(c.v, keys)
        return lit(v as Extract<CodeValue, { k: 'lit' }>['v'])
      }
      issue(ctx, obj, `Unknown name "${obj.name}": only render-function parameters (p in {p => …}) and consts holding literals can be used`)
      return lit(null)
    }
    case 'UnaryExpression': {
      if (e.operator === '!') {
        const inner = unwrap(e.argument)
        if (inner.type === 'UnaryExpression' && inner.operator === '!') return { k: 'bool', v: value(ctx, inner.argument, scope) }
        return { k: 'not', v: value(ctx, e.argument, scope) }
      }
      if (e.operator === '-' && unwrap(e.argument).type === 'NumericLiteral') return lit(-(unwrap(e.argument) as t.NumericLiteral).value)
      issue(ctx, e, `The ${e.operator} operator isn't allowed`)
      return lit(null)
    }
    case 'BinaryExpression': {
      if (e.left.type === 'PrivateName') {
        issue(ctx, e, "That expression isn't allowed")
        return lit(null)
      }
      const a = value(ctx, e.left, scope)
      const b = value(ctx, e.right, scope)
      switch (e.operator) {
        case '===':
        case '==':
          return { k: 'eq', a, b }
        case '!==':
        case '!=':
          return { k: 'not', v: { k: 'eq', a, b } }
        case '<':
        case '<=':
        case '>':
        case '>=':
          return { k: 'cmp', op: e.operator, a, b }
        case '+':
          return { k: 'tpl', parts: [...(a.k === 'tpl' ? a.parts : [a]), ...(b.k === 'tpl' ? b.parts : [b])] }
        default:
          issue(ctx, e, `The ${e.operator} operator isn't allowed: only comparisons, + to join text, &&, || and ?:`)
          return lit(null)
      }
    }
    case 'LogicalExpression': {
      const a = value(ctx, e.left, scope)
      const b = value(ctx, e.right, scope)
      return e.operator === '&&' ? { k: 'cond', test: a, then: b, else: lit(null) } : { k: 'cond', test: a, then: a, else: b }
    }
    case 'ConditionalExpression':
      return { k: 'cond', test: value(ctx, e.test, scope), then: value(ctx, e.consequent, scope), else: value(ctx, e.alternate, scope) }
    case 'ObjectExpression': {
      const out: Record<string, CodeValue> = {}
      for (const p of e.properties) {
        if (p.type === 'SpreadElement') {
          issue(ctx, p, "Spreads ({...x}) aren't allowed")
          continue
        }
        if (p.type === 'ObjectMethod' || p.computed) {
          issue(ctx, p, 'Objects hold plain keys and values only')
          continue
        }
        const k = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : p.key.type === 'NumericLiteral' ? String(p.key.value) : null
        if (k == null || FORBIDDEN_KEYS.has(k)) {
          issue(ctx, p, 'Objects hold plain keys and values only')
          continue
        }
        out[k] = value(ctx, p.value, scope)
      }
      const vals = Object.values(out)
      return vals.every(isLit) ? lit(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, (v as Extract<CodeValue, { k: 'lit' }>).v]))) : { k: 'obj', v: out }
    }
    case 'ArrayExpression': {
      const out: CodeValue[] = []
      for (const el of e.elements) {
        if (!el || el.type === 'SpreadElement') {
          issue(ctx, el ?? e, el ? "Spreads (...x) aren't allowed" : 'Lists cannot have holes')
          continue
        }
        out.push(value(ctx, el, scope))
      }
      return out.every(isLit) ? lit(out.map(v => (v as Extract<CodeValue, { k: 'lit' }>).v)) : { k: 'arr', v: out }
    }
    case 'JSXElement':
    case 'JSXFragment':
      issue(ctx, e, "JSX can't be used as a value here (props take text, numbers, lists, objects or data)")
      return lit(null)
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      issue(ctx, e, "Functions are only allowed as a component's render function ({p => …}) or in LIST.map(item => …)")
      return lit(null)
    case 'CallExpression':
    case 'OptionalCallExpression':
    case 'NewExpression':
      issue(ctx, e, e.type === 'NewExpression' && !(e.callee.type === 'Identifier' && e.callee.name === 'Date') ? "`new` isn't allowed" : callMessage(e))
      return lit(null)
    case 'TaggedTemplateExpression':
      issue(ctx, e, "Tagged templates aren't allowed")
      return lit(null)
    case 'AssignmentExpression':
    case 'UpdateExpression':
      issue(ctx, e, "Assignments aren't allowed")
      return lit(null)
    default:
      issue(ctx, e, `${e.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} isn't allowed`)
      return lit(null)
  }
}

/** A className: class names written out (strings, template literals, ternaries of them). */
function classValue(ctx: Ctx, raw: t.Node, scope: Scope): CodeValue {
  const e = unwrap(raw)
  const take = (s: string, node: t.Node) => {
    for (const c of splitClasses(s)) {
      if (!safeClass(c)) issue(ctx, node, `The class "${c.slice(0, 60)}" isn't allowed (no url(), quotes outside [...] or backslashes)`)
      else ctx.classes.add(c)
    }
  }
  switch (e.type) {
    case 'StringLiteral':
      take(e.value, e)
      return lit(e.value)
    case 'TemplateLiteral': {
      const parts: (string | CodeValue)[] = []
      e.quasis.forEach((q, i) => {
        const s = q.value.cooked ?? ''
        const next = e.expressions[i]
        if ((next && /\S$/.test(s)) || (i > 0 && /^\S/.test(s)))
          issue(ctx, q, "Don't build class names from pieces (px-${…}): write whole class names and pick them with a ternary")
        take(s, q)
        if (s) parts.push(s)
        if (next) parts.push(classValue(ctx, next, scope))
      })
      return parts.length === 1 && typeof parts[0] === 'string' ? lit(parts[0]) : { k: 'tpl', parts }
    }
    case 'ConditionalExpression':
      return { k: 'cond', test: value(ctx, e.test, scope), then: classValue(ctx, e.consequent, scope), else: classValue(ctx, e.alternate, scope) }
    case 'LogicalExpression':
      if (e.operator === '&&') return { k: 'cond', test: value(ctx, e.left, scope), then: classValue(ctx, e.right, scope), else: lit('') }
      break
    case 'Identifier': {
      const c = ctx.consts.get(e.name)
      if (c && isLit(c) && typeof c.v === 'string') {
        take(c.v, e)
        return c
      }
      break
    }
    case 'JSXExpressionContainer':
      return classValue(ctx, e.expression, scope)
  }
  issue(ctx, e, 'className takes class names written out: a string, a template literal, or cond ? "a b" : "c d"')
  return lit('')
}

/** An attribute's value: a string, or an expression; `<x flag>` is true. */
function attrValue(ctx: Ctx, v: t.JSXAttribute['value'], scope: Scope): CodeValue | null {
  if (v == null) return lit(true)
  if (v.type === 'StringLiteral') return lit(v.value)
  if (v.type === 'JSXExpressionContainer') {
    if (v.expression.type === 'JSXEmptyExpression') return null
    return value(ctx, v.expression, scope)
  }
  issue(ctx, v, "JSX can't be used as an attribute value")
  return null
}

function firstStatic(v: CodeValue): string | null {
  if (v.k === 'lit') return typeof v.v === 'string' ? v.v : null
  if (v.k === 'tpl') return typeof v.parts[0] === 'string' ? v.parts[0] : ''
  return ''
}

function checkUrl(ctx: Ctx, node: t.Node, name: 'href' | 'src', v: CodeValue) {
  if (v.k === 'lit') {
    if (v.v == null || v.v === '') return
    if (typeof v.v !== 'string' || !(name === 'href' ? safeHref(v.v) : safeSrc(v.v)))
      issue(ctx, node, `${name}="${String(v.v).slice(0, 80)}" isn't allowed: use https:// URLs or same-site paths like /products${name === 'href' ? ' (or #section, mailto:, tel:)' : ''}`)
    return
  }
  const prefix = firstStatic(v)
  if (prefix && !(name === 'href' ? /^(https:\/\/|\/(?![/\\])|#|mailto:|tel:)/i : /^(https:\/\/|\/(?![/\\]))/i).test(prefix))
    issue(ctx, node, `${name} must start with https:// or a / path`)
}

function badAttr(ctx: Ctx, a: t.JSXAttribute, name: string): boolean {
  if (/^on[A-Z]/.test(name) || /^on[a-z]+$/.test(name)) issue(ctx, a, `Event handlers (${name}) aren't allowed: interactivity comes from library components`)
  else if (name === 'ref') issue(ctx, a, "refs aren't allowed")
  else if (name === 'dangerouslySetInnerHTML') issue(ctx, a, "dangerouslySetInnerHTML isn't allowed")
  else if (name === 'style') issue(ctx, a, "style isn't allowed: use Tailwind classes in className")
  else if (name === 'srcSet' || name === 'srcset' || name === 'formAction' || name === 'action') issue(ctx, a, `${name} isn't allowed`)
  else return false
  return true
}

/** React's JSX text rule: lines trimmed, line breaks collapsed to one space, blank lines dropped. */
function jsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/)
  let last = 0
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) last = i
  })
  let out = ''
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, ' ')
    if (i > 0) s = s.replace(/^ +/, '')
    if (i < lines.length - 1) s = s.replace(/ +$/, '')
    if (s) out += i === last ? s : `${s} `
  })
  return out
}

type Walk = { depth: number; guarded: boolean }

function children(ctx: Ctx, list: t.JSXElement['children'], scope: Scope, w: Walk): CodeNode[] {
  const out: CodeNode[] = []
  for (const c of list) {
    if (c.type === 'JSXText') {
      const s = jsxText(c.value)
      if (s) out.push({ t: 'text', value: s })
    } else if (c.type === 'JSXExpressionContainer') {
      if (c.expression.type === 'JSXEmptyExpression') continue
      const n = node(ctx, c.expression, scope, w)
      if (n) out.push(n)
    } else if (c.type === 'JSXSpreadChild') issue(ctx, c, "Spread children aren't allowed")
    else {
      const n = node(ctx, c, scope, w)
      if (n) out.push(n)
    }
  }
  return out
}

/** An arrow's parameters as scope bindings: `p`, `{ name, price }`, and an optional index. */
function arrowScope(ctx: Ctx, fn: t.ArrowFunctionExpression, scope: Scope, fields: Set<string> | null, label: string): { scope: Scope; param: string; index?: string } | null {
  if (fn.async || fn.params.length < 1 || fn.params.length > 2) {
    issue(ctx, fn, `${label}: write the function as item => <…/> or (item, i) => <…/>`)
    return null
  }
  const next = new Map(scope)
  const [first, second] = fn.params
  let param: string
  if (first.type === 'Identifier') {
    param = first.name
    next.set(first.name, { root: first.name, prefix: [], fields, label: `${first.name} (${label})` })
  } else if (first.type === 'ObjectPattern') {
    param = `$${++ctx.uid}`
    for (const p of first.properties) {
      if (p.type !== 'ObjectProperty' || p.computed || p.key.type !== 'Identifier' || p.value.type !== 'Identifier') {
        issue(ctx, p, `${label}: destructure plain fields only ({ name, price })`)
        continue
      }
      if (fields && !fields.has(p.key.name)) issue(ctx, p, `${label} has no field "${p.key.name}". Fields: ${[...fields].join(', ')}`)
      next.set(p.value.name, { root: param, prefix: [p.key.name], fields: null, label })
    }
  } else {
    issue(ctx, first, `${label}: the parameter must be a name (p) or { field, field }`)
    return null
  }
  let index: string | undefined
  if (second) {
    if (second.type !== 'Identifier') issue(ctx, second, `${label}: the second parameter must be a name (the index)`)
    else {
      index = second.name
      next.set(second.name, { root: second.name, prefix: [], fields: new Set(), label: `${second.name} (the index)` })
    }
  }
  return { scope: next, param, index }
}

function arrowBody(ctx: Ctx, fn: t.ArrowFunctionExpression, scope: Scope, w: Walk): CodeNode {
  if (fn.body.type !== 'BlockStatement') return node(ctx, fn.body, scope, w) ?? empty
  const stmts = fn.body.body
  if (stmts.length === 1 && stmts[0].type === 'ReturnStatement' && stmts[0].argument) return node(ctx, stmts[0].argument, scope, w) ?? empty
  issue(ctx, fn.body, 'A render function returns JSX directly: item => <…/> (no statements)')
  return empty
}

function mapNode(ctx: Ctx, e: t.CallExpression, scope: Scope, w: Walk): CodeNode | null {
  const callee = e.callee as t.MemberExpression
  const fn = e.arguments[0]
  if (e.arguments.length !== 1 || !fn || fn.type !== 'ArrowFunctionExpression') {
    issue(ctx, e, '.map takes one arrow function: LIST.map(item => <…/>)')
    return null
  }
  const items = value(ctx, callee.object, scope)
  if (items.k === 'lit' && !Array.isArray(items.v)) {
    issue(ctx, callee.object, '.map works on a list')
    return null
  }
  const bound = arrowScope(ctx, fn, scope, null, 'the list item')
  if (!bound) return null
  const body = arrowBody(ctx, fn, bound.scope, { ...w, guarded: true })
  return { t: 'each', items, param: bound.param, ...(bound.index ? { index: bound.index } : {}), body }
}

function node(ctx: Ctx, raw: t.Node, scope: Scope, w: Walk): CodeNode | null {
  const e = unwrap(raw)
  switch (e.type) {
    case 'JSXElement':
      return element(ctx, e, scope, w)
    case 'JSXFragment':
      if (w.depth > MAX_DEPTH) capIssue(ctx, 'depth', e, `Nested too deep (max depth ${MAX_DEPTH}): flatten the markup`)
      return { t: 'frag', children: children(ctx, e.children, scope, { ...w, depth: w.depth + 1 }) }
    case 'ConditionalExpression': {
      const els = node(ctx, e.alternate, scope, { ...w, guarded: true })
      return { t: 'cond', test: value(ctx, e.test, scope), then: node(ctx, e.consequent, scope, { ...w, guarded: true }) ?? empty, ...(els ? { else: els } : {}) }
    }
    case 'LogicalExpression': {
      const right = unwrap(e.right)
      if (e.operator === '&&') return { t: 'cond', test: value(ctx, e.left, scope), then: node(ctx, e.right, scope, { ...w, guarded: true }) ?? empty }
      if (right.type === 'JSXElement' || right.type === 'JSXFragment') {
        const left = value(ctx, e.left, scope)
        return { t: 'cond', test: left, then: { t: 'expr', value: left }, else: node(ctx, right, scope, { ...w, guarded: true }) ?? empty }
      }
      return { t: 'expr', value: value(ctx, e, scope) }
    }
    case 'StringLiteral':
      return { t: 'text', value: e.value }
    case 'NumericLiteral':
      return { t: 'text', value: String(e.value) }
    case 'NullLiteral':
    case 'BooleanLiteral':
      return null
    case 'Identifier':
      if (e.name === 'undefined') return null
      return { t: 'expr', value: value(ctx, e, scope) }
    case 'CallExpression':
      if (e.callee.type === 'MemberExpression' && !e.callee.computed && e.callee.property.type === 'Identifier' && e.callee.property.name === 'map') return mapNode(ctx, e, scope, w)
      issue(ctx, e, callMessage(e))
      return null
    default:
      return { t: 'expr', value: value(ctx, e, scope) }
  }
}

function element(ctx: Ctx, e: t.JSXElement, scope: Scope, w: Walk): CodeNode | null {
  ctx.nodes++
  if (ctx.nodes > MAX_NODES) capIssue(ctx, 'nodes', e, `Too many JSX elements (max ${MAX_NODES}): simplify the section`)
  if (w.depth > MAX_DEPTH) capIssue(ctx, 'depth', e, `Nested too deep (max depth ${MAX_DEPTH}): flatten the markup`)
  const nameNode = e.openingElement.name
  if (nameNode.type !== 'JSXIdentifier') {
    issue(ctx, nameNode, 'Use plain tag or component names (no <a.b> or <a:b>)')
    return null
  }
  const name = nameNode.name
  const inner: Walk = { ...w, depth: w.depth + 1 }
  return /^[a-z]/.test(name) ? htmlElement(ctx, e, name, scope, inner) : component(ctx, e, name, scope, inner, w.guarded)
}

function htmlElement(ctx: Ctx, e: t.JSXElement, tag: string, scope: Scope, w: Walk): CodeNode | null {
  if (BLOCKED_TAGS[tag]) {
    issue(ctx, e, `<${tag}> isn't allowed: ${BLOCKED_TAGS[tag]}`)
    return null
  }
  if (!HTML_TAGS.has(tag)) {
    issue(ctx, e, `<${tag}> isn't an allowed tag. Use one of: ${[...HTML_TAGS].join(', ')}, or a library component`)
    return null
  }
  const props: Record<string, CodeValue> = {}
  for (const a of e.openingElement.attributes) {
    if (a.type === 'JSXSpreadAttribute') {
      issue(ctx, a, "Spread props ({...x}) aren't allowed")
      continue
    }
    if (a.name.type === 'JSXNamespacedName') {
      issue(ctx, a, "Namespaced attributes (a:b) aren't allowed")
      continue
    }
    const name = a.name.name === 'class' ? 'className' : a.name.name
    if (badAttr(ctx, a, name)) continue
    if (name === 'className') {
      if (a.value) props.className = a.value.type === 'StringLiteral' ? classValue(ctx, a.value, scope) : classValue(ctx, a.value as t.Node, scope)
      continue
    }
    if (name === 'key') continue
    if (!attrAllowed(tag, name)) {
      issue(ctx, a, `<${tag}> can't take ${name}. Allowed: className, id, title, role, aria-*${tag === 'a' ? ', href, target' : tag === 'img' ? ', src, alt, width, height, loading' : ''}`)
      continue
    }
    const v = attrValue(ctx, a.value, scope)
    if (!v) continue
    if (name === 'href' || name === 'src') checkUrl(ctx, a, name, v)
    if (name === 'target' && !(v.k === 'lit' && (v.v === '_blank' || v.v === '_self'))) {
      issue(ctx, a, 'target is "_blank" or "_self"')
      continue
    }
    if (name === 'id' && !(v.k === 'lit' && typeof v.v === 'string' && /^[A-Za-z][\w-]{0,40}$/.test(v.v))) {
      issue(ctx, a, 'id is a short literal name (letters, digits, - and _)')
      continue
    }
    props[name] = v
  }
  if (VOID_TAGS.has(tag)) {
    if (e.children.some(c => c.type !== 'JSXText' || c.value.trim())) issue(ctx, e, `<${tag}> can't have children`)
    return { t: 'el', tag, props, children: [] }
  }
  return { t: 'el', tag, props, children: children(ctx, e.children, scope, w) }
}

/** Prop names a component accepts, when its schema is an object. */
function propKeys(def: CodeComponentDef): Set<string> | null {
  const shape = (def.props as { shape?: Record<string, unknown> }).shape
  return shape && typeof shape === 'object' ? new Set(Object.keys(shape)) : null
}

function component(ctx: Ctx, e: t.JSXElement, name: string, scope: Scope, w: Walk, guarded: boolean): CodeNode | null {
  const def = ctx.lib.get(name)
  if (!def) {
    const names = [...ctx.lib.values()].filter(d => allowedOnPage(d, ctx.page)).map(d => d.name)
    issue(ctx, e, `Unknown component <${name}>. Use HTML tags or library components: ${names.join(', ')}`)
    return null
  }
  if (!allowedOnPage(def, ctx.page)) {
    issue(ctx, e, `<${name}> can't be used on the ${ctx.page} page`)
    return null
  }
  ctx.components.add(name)
  if (ONCE_COMPONENTS.has(name)) {
    ctx.once.set(name, (ctx.once.get(name) ?? 0) + 1)
    if (guarded) issue(ctx, e, `<${name} /> can't be inside a condition, a list or a render function: it always shows, exactly once`)
  }
  const keys = propKeys(def)
  const props: Record<string, CodeValue> = {}
  for (const a of e.openingElement.attributes) {
    if (a.type === 'JSXSpreadAttribute') {
      issue(ctx, a, "Spread props ({...x}) aren't allowed")
      continue
    }
    if (a.name.type === 'JSXNamespacedName') {
      issue(ctx, a, "Namespaced attributes (a:b) aren't allowed")
      continue
    }
    const pn = a.name.name === 'class' ? 'className' : a.name.name
    if (badAttr(ctx, a, pn) || pn === 'key') continue
    if (pn === 'className') {
      if (a.value) props.className = classValue(ctx, a.value as t.Node, scope)
      continue
    }
    if (keys && !keys.has(pn)) {
      issue(ctx, a, `<${name}> has no prop "${pn}". Props: ${[...keys, 'className'].join(', ')}`)
      continue
    }
    // Class props of a part (itemClassName, inputClassName…) are class names too: checked, and built into the CSS.
    if (pn.endsWith('ClassName')) {
      if (a.value) props[pn] = classValue(ctx, a.value as t.Node, scope)
      continue
    }
    const v = attrValue(ctx, a.value, scope)
    if (!v) continue
    if (pn === 'href') checkUrl(ctx, a, 'href', v)
    if (pn === 'src') checkUrl(ctx, a, 'src', v)
    props[pn] = v
  }
  // Literal props are checked now; bound ones (product={p}) at render.
  const literal: Record<string, unknown> = {}
  const bound = new Set<string>()
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') continue
    if (v.k === 'lit') literal[k] = v.v
    else bound.add(k)
  }
  const parsed = def.props.safeParse(literal)
  if (!parsed.success)
    for (const zi of parsed.error.issues) {
      const key = String(zi.path[0] ?? '')
      if (key && bound.has(key)) continue
      issue(ctx, e, `<${name}>${zi.path.length ? ` ${zi.path.join('.')}` : ''}: ${zi.message}`)
    }

  const meaningful = e.children.filter(c => !(c.type === 'JSXText' && !c.value.trim()) && !(c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression'))
  const fnChild = meaningful.find(
    (c): c is t.JSXExpressionContainer => c.type === 'JSXExpressionContainer' && (unwrap(c.expression).type === 'ArrowFunctionExpression' || unwrap(c.expression).type === 'FunctionExpression')
  )
  if (fnChild) {
    const fn = unwrap(fnChild.expression)
    if (!def.binding) {
      issue(ctx, fnChild, `<${name}> doesn't take a render function`)
      return { t: 'cmp', name, props, children: [] }
    }
    if (fn.type !== 'ArrowFunctionExpression') {
      issue(ctx, fn, `Write the render function as an arrow: {p => <…/>}`)
      return { t: 'cmp', name, props, children: [] }
    }
    if (meaningful.length > 1) issue(ctx, e, `Put only the render function inside <${name}>`)
    const b = arrowScope(ctx, fn, scope, new Set(Object.keys(def.binding)), `<${name}>`)
    if (!b) return { t: 'cmp', name, props, children: [] }
    const body = arrowBody(ctx, fn, b.scope, { ...w, guarded: true })
    return { t: 'cmp', name, props, children: [], render: { param: b.param, ...(b.index ? { index: b.index } : {}), body } }
  }
  if (SLIDERS.has(name)) {
    const kids = meaningful.filter(c => c.type === 'JSXElement')
    const only = kids.length === 1 ? (kids[0] as t.JSXElement).openingElement.name : null
    if (only?.type === 'JSXIdentifier' && DATA_LISTS.has(only.name))
      issue(ctx, e, `To slide ${only.name.toLowerCase()}, put layout="carousel" on <${only.name}> instead of wrapping it in <${name}>`)
  }
  return { t: 'cmp', name, props, children: children(ctx, e.children, scope, w) }
}

/** FNV-1a, for a stable scope id per source. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const isFn = (n: t.Node | null | undefined): n is t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration =>
  !!n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration')

/** `const NAME = <literal>` (or, at the top level, a component function). */
function constDecl(ctx: Ctx, st: t.VariableDeclaration, fns: Map<string, t.Node> | null): void {
  if (st.kind !== 'const') issue(ctx, st, `Use const, not ${st.kind}`)
  for (const d of st.declarations) {
    if (d.id.type !== 'Identifier' || !d.init) {
      issue(ctx, d, 'Declare constants as const NAME = <literal>')
      continue
    }
    const init = unwrap(d.init)
    if (isFn(init)) {
      if (fns) fns.set(d.id.name, init)
      else issue(ctx, d, 'Helper functions and components aren\'t allowed: put the markup inline, or use LIST.map(item => <…/>)')
      continue
    }
    const before = ctx.issues.length
    const v = value(ctx, init, new Map())
    if (ctx.issues.length > before) continue
    if (!isLit(v)) {
      issue(ctx, d, `const ${d.id.name} must hold a literal (text, number, list or object of literals)`)
      continue
    }
    ctx.consts.set(d.id.name, v)
  }
}

function checkImport(ctx: Ctx, st: t.ImportDeclaration) {
  const src = st.source.value
  if (st.importKind === 'type') return
  if (src === 'react') return
  if (!LIBRARY_MODULES.has(src)) {
    issue(ctx, st, `Only import from '${LIBRARY_MODULE}' (found '${src}')`)
    return
  }
  for (const s of st.specifiers) {
    if (s.type !== 'ImportSpecifier') {
      issue(ctx, s, `Import library components by name: import { Products } from '${LIBRARY_MODULE}'`)
      continue
    }
    const imported = s.imported.type === 'Identifier' ? s.imported.name : s.imported.value
    const def = ctx.lib.get(imported)
    if (!def) issue(ctx, s, `'${LIBRARY_MODULE}' has no component ${imported}`)
    else if (!allowedOnPage(def, ctx.page)) issue(ctx, s, `<${imported}> can't be used on the ${ctx.page} page`)
    if (s.local.name !== imported) issue(ctx, s, 'Import components under their own names (no `as`)')
  }
}

const CARD_HINT = 'The card takes the product as its one prop: export default function Card({ p }) { return (…) }'

/** A site card's one prop, the product (`({ p })`, `({ product })` or `({ product: p })`), bound to its fields. */
function cardScopeOf(ctx: Ctx, fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration): Scope {
  const scope: Scope = new Map()
  const first = fn.params[0]
  if (fn.params.length !== 1 || first.type !== 'ObjectPattern') {
    issue(ctx, first ?? fn, CARD_HINT)
    return scope
  }
  const fields = new Set(Object.keys(PRODUCT_FIELDS))
  for (const p of first.properties) {
    if (p.type !== 'ObjectProperty' || p.computed || p.key.type !== 'Identifier' || (p.key.name !== 'p' && p.key.name !== 'product') || p.value.type !== 'Identifier') {
      issue(ctx, p, CARD_HINT)
      continue
    }
    scope.set(p.value.name, { root: CARD_PRODUCT, prefix: [], fields, label: `${p.value.name} (the product)` })
  }
  if (!scope.size) issue(ctx, first, CARD_HINT)
  return scope
}

/** Parses and checks the source, without building CSS. */
export function checkSection(source: string, ctx0: { page: PageKey | null }): { ok: true; ast: CodeNode; classes: string[]; components: string[]; id: string } | { ok: false; issues: CompileIssue[] } {
  if (typeof source !== 'string' || !source.trim()) return { ok: false, issues: [{ message: 'The section has no code' }] }
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES)
    return { ok: false, issues: [{ message: `The section is over ${MAX_SOURCE_BYTES / 1024} KB: shorten it` }] }
  let file: t.File
  try {
    file = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }) as unknown as t.File
  } catch (err) {
    const e = err as { message?: string; loc?: { line?: number } }
    return { ok: false, issues: [{ message: `Syntax error: ${String(e.message ?? err).replace(/\s*\(\d+:\d+\)$/, '')}`, ...(e.loc?.line ? { line: e.loc.line } : {}) }] }
  }
  const ctx: Ctx = {
    page: ctx0.page ?? null,
    lib: codeLibrary(),
    issues: [],
    classes: new Set(),
    components: new Set(),
    consts: new Map(),
    nodes: 0,
    uid: 0,
    once: new Map(),
    capped: new Set(),
  }

  const fns = new Map<string, t.Node>()
  let main: t.Node | null = null
  let defaultName: string | null = null
  for (const st of file.program.body) {
    switch (st.type) {
      case 'ImportDeclaration':
        checkImport(ctx, st)
        break
      case 'ExportDefaultDeclaration': {
        const d = unwrap(st.declaration)
        if (isFn(d)) {
          main = d
          if (d.type === 'FunctionDeclaration' && d.id) fns.set(d.id.name, d)
        } else if (d.type === 'Identifier') defaultName = d.name
        else issue(ctx, st, 'export default the section component: export default function Section() { return (…) }')
        break
      }
      case 'ExportNamedDeclaration':
        if (st.declaration?.type === 'FunctionDeclaration' && st.declaration.id) fns.set(st.declaration.id.name, st.declaration)
        else if (st.declaration?.type === 'VariableDeclaration') constDecl(ctx, st.declaration, fns)
        else if (st.declaration?.type === 'TSTypeAliasDeclaration' || st.declaration?.type === 'TSInterfaceDeclaration') break
        else issue(ctx, st, 'Only the section component is exported')
        break
      case 'FunctionDeclaration':
        if (st.id) fns.set(st.id.name, st)
        break
      case 'VariableDeclaration':
        constDecl(ctx, st, fns)
        break
      case 'TSTypeAliasDeclaration':
      case 'TSInterfaceDeclaration':
      case 'EmptyStatement':
        break
      default:
        issue(ctx, st, 'Only imports, `const NAME = <literal>` and one component function are allowed at the top level')
    }
  }
  if (!main && defaultName) main = fns.get(defaultName) ?? null
  if (!main && fns.size === 1) main = [...fns.values()][0]
  const others = [...fns.values()].filter(f => f !== main)
  for (const f of others) issue(ctx, f, "Write one component: helper components aren't supported (put the markup inline, or use LIST.map(item => <…/>))")
  if (!main || !isFn(main)) {
    if (!ctx.issues.length) issue(ctx, null, 'Write the section as one component: export default function Section() { return (…) }')
    return { ok: false, issues: ctx.issues }
  }

  const fn = main
  // A site card takes the product it is drawn for; any other section takes nothing.
  const top = ctx.page === CARD_PAGE ? cardScopeOf(ctx, fn) : new Map<string, Binding>()
  if (ctx.page !== CARD_PAGE && fn.params.length) issue(ctx, fn.params[0], 'The section component takes no props')
  if (fn.async || fn.generator) issue(ctx, fn, 'The section component is a plain function (not async or a generator)')
  let ret: t.Node | null = null
  if (fn.body.type === 'BlockStatement') {
    for (const st of fn.body.body) {
      if (st.type === 'VariableDeclaration') constDecl(ctx, st, null)
      else if (st.type === 'ReturnStatement') {
        if (ret) issue(ctx, st, 'Return once, at the end')
        ret = st.argument ?? null
      } else if (st.type !== 'TSTypeAliasDeclaration' && st.type !== 'TSInterfaceDeclaration' && st.type !== 'EmptyStatement')
        issue(ctx, st, 'Inside the component, only `const NAME = <literal>` and one `return (…)` are allowed')
    }
  } else ret = fn.body
  if (!ret) {
    issue(ctx, fn, 'The component must return JSX')
    return { ok: false, issues: ctx.issues }
  }
  const root = unwrap(ret)
  if (root.type !== 'JSXElement' && root.type !== 'JSXFragment') issue(ctx, root, 'The component must return JSX: return (<section …>…</section>)')
  const ast = node(ctx, root, top, { depth: 1, guarded: false }) ?? empty

  for (const [n, count] of ctx.once) if (count > 1) issue(ctx, null, `<${n} /> must appear exactly once (found ${count})`)
  if (ctx.classes.size > MAX_CLASSES) issue(ctx, null, `Too many distinct classes (${ctx.classes.size}, max ${MAX_CLASSES})`)
  if (ctx.issues.length) return { ok: false, issues: ctx.issues }
  return { ok: true, ast, classes: [...ctx.classes].sort(), components: [...ctx.components].sort(), id: `cs-${hash(source)}` }
}

export async function compileSection(source: string, ctx: { page: PageKey | null }): Promise<CompileResult> {
  const r = checkSection(source, ctx)
  if (!r.ok) return r
  let css: string
  try {
    css = await compileSectionCss(r.classes, ctx.page === CARD_PAGE ? cardScope(r.id) : r.id)
  } catch (err) {
    console.error('[code-section] css', err)
    return { ok: false, issues: [{ message: `The section's styles could not be built (${err instanceof Error ? err.message : String(err)})` }] }
  }
  return { ok: true, section: { id: r.id, ast: r.ast, classes: r.classes, css, components: r.components } }
}

// ── Whole pages ────────────────────────────────────────────────────────────────────────────────

export const CODE_SECTION = 'code_section'

export class CodeSectionInvalid extends Error {
  constructor(readonly issues: { blockId?: string; message: string }[]) {
    super(issues[0]?.message ?? 'Invalid code section')
  }
}

export function countComponent(n: CodeNode | null | undefined, name: string): number {
  if (!n || typeof n !== 'object') return 0
  switch (n.t) {
    case 'el':
    case 'frag':
      return n.children.reduce((s, c) => s + countComponent(c, name), 0)
    case 'cmp':
      return (n.name === name ? 1 : 0) + n.children.reduce((s, c) => s + countComponent(c, name), 0) + countComponent(n.render?.body, name)
    case 'cond':
      return countComponent(n.then, name) + countComponent(n.else, name)
    case 'each':
      return countComponent(n.body, name)
    default:
      return 0
  }
}

/** Page-level rules over every code section: required parts present, once-only parts exactly once. */
export function checkPageParts(doc: PageDoc, page: PageKey, coreType?: string | null): CompileIssue[] {
  const sections = Object.values(doc.blocks)
    .filter(b => b.type === CODE_SECTION && !b.visibility?.hidden)
    .map(b => (b.props as { compiled?: CompiledSection | null }).compiled)
    .filter((c): c is CompiledSection => !!c && typeof c === 'object' && !!c.ast)
  if (!sections.length) return []
  const hasCore = !!coreType && Object.values(doc.blocks).some(b => b.type === coreType)
  const issues: CompileIssue[] = []
  const count = (name: string) => sections.reduce((s, c) => s + countComponent(c.ast, name), 0)
  for (const def of codeLibrary().values()) {
    const n = count(def.name)
    if (ONCE_COMPONENTS.has(def.name)) {
      if (hasCore && n > 0) issues.push({ message: `The page's own ${page} block already has the payment step: remove <${def.name} />` })
      else if (n > 1) issues.push({ message: `<${def.name} /> must appear exactly once on the page (found ${n})` })
    }
    if (!hasCore && def.required?.includes(page) && n === 0) issues.push({ message: `This page needs <${def.name} /> in one of its sections` })
  }
  return issues
}

/**
 * Every code section recompiled from its source (stored ASTs are never trusted), then the page-level rules when the
 * page is known. Throws CodeSectionInvalid with the issues, per block.
 */
export async function recompileCodeSections(doc: PageDoc, ctx: { page?: PageKey | null; coreType?: string | null } = {}): Promise<PageDoc> {
  const blocks = { ...doc.blocks }
  const issues: { blockId?: string; message: string }[] = []
  for (const b of Object.values(doc.blocks)) {
    if (b.type !== CODE_SECTION) continue
    const source = typeof b.props?.source === 'string' ? (b.props.source as string) : ''
    const label = typeof b.props?.label === 'string' && b.props.label ? (b.props.label as string) : 'Code section'
    const r = await compileSection(source, { page: ctx.page ?? null })
    if (!r.ok) {
      issues.push(...r.issues.map(i => ({ blockId: b.id, message: `${label}: ${i.line ? `line ${i.line}: ` : ''}${i.message}` })))
      continue
    }
    blocks[b.id] = { ...b, props: { ...b.props, compiled: r.section } }
  }
  const next = { ...doc, blocks }
  const coreType = ctx.coreType !== undefined ? ctx.coreType : ctx.page ? (coreBlockFor(ctx.page)?.type ?? null) : null
  if (!issues.length && ctx.page) issues.push(...checkPageParts(next, ctx.page, coreType))
  if (issues.length) throw new CodeSectionInvalid(issues)
  return next
}
