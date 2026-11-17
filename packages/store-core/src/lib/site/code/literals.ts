import { parse } from '@babel/parser'
import type * as t from '@babel/types'
import { safeHref, safeSrc } from './allow'

// The words, links and pictures written into a code section's source, for editing without code: visible JSX text,
// text props of library components, internal link targets, image URLs and alt text, including those in consts the
// markup maps over. Read from the source's AST; an edit replaces just that literal, and the normal save path
// recompiles the section. Data-bound values (p.name) are not literals and are never listed.

export type LiteralKind = 'text' | 'link' | 'image' | 'alt'

export interface CodeLiteral {
  /** Its offset in the source: valid for that source only. */
  id: string
  kind: LiteralKind
  value: string
  /** What it is on the page ("Heading", "Button text", "Link"). */
  label: string
  line: number
}

export interface LiteralEdit {
  id: string
  /** The value the editor showed; an edit to a section that changed meanwhile is refused. */
  from: string
  to: string
}

export class LiteralEditError extends Error {}

const MAX_LITERALS = 150
type Str = t.StringLiteral | t.TemplateLiteral | t.JSXText
interface Found {
  node: Str
  kind: LiteralKind
  label: string
  /** Where it shows: its first use in the markup (a mapped list's items sort together, in list order). */
  at: number
}
interface Ctx {
  found: Map<number, Found>
  /** Offsets of strings written straight into a JSX attribute (href="/x"), which need JSX quoting. */
  attrValues: Set<number>
  consts: Map<string, t.Node>
}
type Scope = Map<string, t.Node[]>

const RANK: Record<LiteralKind, number> = { link: 3, image: 2, alt: 1, text: 0 }

const TAG_LABEL: Record<string, string> = {
  h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Subheading', h5: 'Subheading', h6: 'Subheading',
  p: 'Text', a: 'Link text', li: 'List item', blockquote: 'Quote', q: 'Quote', figcaption: 'Caption', cite: 'Name',
  summary: 'Question', th: 'Table heading', td: 'Table text', dt: 'Term', dd: 'Description', time: 'Date', small: 'Small print',
  Link: 'Link text', AccordionItem: 'Answer', Tab: 'Tab text', Marquee: 'Moving text',
}
const TEXT_KEYS: Record<string, string> = {
  label: 'Button text', title: 'Title', text: 'Text', heading: 'Heading', subheading: 'Subheading', subtitle: 'Subheading',
  eyebrow: 'Eyebrow', kicker: 'Eyebrow', caption: 'Caption', message: 'Message', messages: 'Message', description: 'Description',
  desc: 'Description', body: 'Text', cta: 'Button text', ctaLabel: 'Button text', buttonLabel: 'Button text', name: 'Name',
  quote: 'Quote', author: 'Name', role: 'Role', badge: 'Badge', tagline: 'Tagline', note: 'Note', placeholder: 'Hint',
  noun: 'What the results are called', emptyText: 'Message when nothing matches',
}
const PROP_LABEL: Record<string, string> = {
  'AccordionItem.title': 'Question', 'Tab.label': 'Tab name', 'Carousel.label': 'Slider name (read aloud)',
  'SearchBox.placeholder': 'Search box hint', 'Countdown.label': 'Countdown label', 'AccountLink.label': 'Account link text',
}
/** Props and data keys of library components that hold shown words (not `name` or `role`: icon names, ARIA). */
const PROP_TEXT = new Set(Object.keys(TEXT_KEYS).filter(k => k !== 'name' && k !== 'role'))
const LINK_KEYS = new Set(['href', 'url', 'link', 'to', 'path'])
const IMAGE_KEYS = new Set(['src', 'hoverSrc', 'image', 'img', 'photo', 'picture', 'imageUrl', 'logo', 'cover', 'thumbnail', 'background', 'bg'])
/** Component props that select data or style it, never shown words. */
const SKIP_PROPS = new Set(['query', 'slugs', 'product', 'className', 'itemClassName', 'sizes', 'endsAt', 'key', 'id', 'role'])
const KIND_LABEL: Record<Exclude<LiteralKind, 'text'>, string> = { link: 'Link', image: 'Picture', alt: 'Picture description' }

const keyKind = (k: string): LiteralKind | null =>
  LINK_KEYS.has(k) ? 'link' : IMAGE_KEYS.has(k) ? 'image' : k === 'alt' ? 'alt' : PROP_TEXT.has(k) ? 'text' : null

export const isInternalLink = (v: string) => (/^\/(?![/\\])/.test(v) || /^#[A-Za-z0-9_-]*$/.test(v)) && safeHref(v) === v

function unwrap(n: t.Node): t.Node {
  let x = n
  while (x.type === 'TSAsExpression' || x.type === 'TSSatisfiesExpression' || x.type === 'TSNonNullExpression' || x.type === 'TSTypeAssertion' || x.type === 'ParenthesizedExpression')
    x = (x as t.TSAsExpression).expression
  return x
}

const strValue = (n: t.Node): string | null =>
  n.type === 'StringLiteral' ? n.value : n.type === 'TemplateLiteral' && !n.expressions.length ? (n.quasis[0]?.value.cooked ?? null) : null

/** React's JSX text rule (as the compiler applies it): lines trimmed, line breaks collapsed to one space. */
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

const valueOf = (n: Str): string => (n.type === 'JSXText' ? jsxText(n.value).trim() : (strValue(n) ?? ''))

const keyName = (k: t.Node): string | null =>
  k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : k.type === 'NumericLiteral' ? String(k.value) : null

function member(n: t.Node, key: string): t.Node[] {
  const x = unwrap(n)
  if (x.type === 'ObjectExpression') {
    for (const p of x.properties) if (p.type === 'ObjectProperty' && !p.computed && keyName(p.key) === key) return [unwrap(p.value)]
    return []
  }
  if (x.type === 'ArrayExpression' && /^\d+$/.test(key)) {
    const el = x.elements[Number(key)]
    return el && el.type !== 'SpreadElement' ? [unwrap(el)] : []
  }
  return []
}

const elementsOf = (n: t.Node): t.Node[] => {
  const x = unwrap(n)
  return x.type === 'ArrayExpression' ? x.elements.filter((e): e is t.Expression => !!e && e.type !== 'SpreadElement').map(unwrap) : []
}

/** The literal nodes an expression may stand for: strings, and the lists and objects consts hold. */
function nodesOf(ctx: Ctx, raw: t.Node, scope: Scope, depth = 0): t.Node[] {
  if (depth > 8) return []
  const e = unwrap(raw)
  switch (e.type) {
    case 'StringLiteral':
    case 'TemplateLiteral':
    case 'ArrayExpression':
    case 'ObjectExpression':
      return [e]
    case 'Identifier': {
      const bound = scope.get(e.name)
      if (bound) return bound
      const c = ctx.consts.get(e.name)
      return c ? [c] : []
    }
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const p = e.property
      const key = !e.computed && p.type === 'Identifier' ? p.name : e.computed && (p.type === 'NumericLiteral' || p.type === 'StringLiteral') ? String(p.value) : null
      return key == null ? [] : nodesOf(ctx, e.object, scope, depth + 1).flatMap(n => member(n, key))
    }
    case 'ConditionalExpression':
      return [...nodesOf(ctx, e.consequent, scope, depth + 1), ...nodesOf(ctx, e.alternate, scope, depth + 1)]
    case 'LogicalExpression':
      return e.operator === '&&' ? nodesOf(ctx, e.right, scope, depth + 1) : [...nodesOf(ctx, e.left, scope, depth + 1), ...nodesOf(ctx, e.right, scope, depth + 1)]
    default:
      return []
  }
}

function mark(ctx: Ctx, raw: t.Node, kind: LiteralKind, label: string, at: number) {
  const n = unwrap(raw)
  if (n.start == null || n.end == null) return
  if (n.type !== 'JSXText' && n.type !== 'StringLiteral' && n.type !== 'TemplateLiteral') return
  if (n.type === 'TemplateLiteral' && n.expressions.length) return
  const v = valueOf(n)
  if (!v && kind !== 'alt') return
  if (kind === 'link' && !isInternalLink(v)) return
  if (kind === 'image' && !safeSrc(v)) return
  const prev = ctx.found.get(n.start)
  if (prev && RANK[prev.kind] >= RANK[kind]) return void (prev.at = Math.min(prev.at, at))
  ctx.found.set(n.start, { node: n, kind, label, at: Math.min(at, prev?.at ?? at) })
}

/** Lists and objects handed to a component prop (links, columns, badges): their fields by name. */
function walkData(ctx: Ctx, raw: t.Node, at: number, depth = 0) {
  if (depth > 6) return
  const n = unwrap(raw)
  if (n.type === 'ArrayExpression') {
    for (const el of elementsOf(n)) walkData(ctx, el, at, depth + 1)
    return
  }
  if (n.type !== 'ObjectExpression') return
  for (const p of n.properties) {
    if (p.type !== 'ObjectProperty' || p.computed) continue
    const k = keyName(p.key)
    if (!k) continue
    const v = unwrap(p.value)
    const target = v.type === 'Identifier' && ctx.consts.has(v.name) ? unwrap(ctx.consts.get(v.name)!) : v
    const kind = keyKind(k)
    if (kind && strValue(target) != null) mark(ctx, target, kind, kind === 'text' ? TEXT_KEYS[k] : KIND_LABEL[kind], at)
    else if (kind === 'text' && target.type === 'ArrayExpression') for (const el of elementsOf(target)) mark(ctx, el, 'text', TEXT_KEYS[k], at)
    else if (target.type === 'ArrayExpression' || target.type === 'ObjectExpression') walkData(ctx, target, at, depth + 1)
  }
}

function attrKind(tag: string, name: string, component: boolean): LiteralKind | null {
  if (name === 'href') return 'link'
  if (name === 'src' || name === 'hoverSrc') return tag === 'img' || component ? 'image' : null
  if (name === 'alt') return 'alt'
  return component && PROP_TEXT.has(name) ? 'text' : null
}

function bindItems(scope: Scope, param: t.Node, items: t.Node[]) {
  if (param.type === 'Identifier') scope.set(param.name, items)
  else if (param.type === 'ObjectPattern')
    for (const p of param.properties) {
      const k = p.type === 'ObjectProperty' && !p.computed ? keyName(p.key) : null
      if (k && p.type === 'ObjectProperty' && p.value.type === 'Identifier') scope.set(p.value.name, items.flatMap(it => member(it, k)))
    }
}
const bindData = (scope: Scope, param: t.Node) => bindItems(scope, param, [])

// `anchor`: the start of the .map being walked, so a list's items sort together in list order.
function walkBody(ctx: Ctx, fn: t.ArrowFunctionExpression | t.FunctionExpression, scope: Scope, tag: string, anchor?: number) {
  if (fn.body.type !== 'BlockStatement') return walkExpr(ctx, fn.body, scope, tag, anchor)
  for (const st of fn.body.body) if (st.type === 'ReturnStatement' && st.argument) walkExpr(ctx, st.argument, scope, tag, anchor)
}

function walkExpr(ctx: Ctx, raw: t.Node, scope: Scope, tag: string, anchor?: number): void {
  const e = unwrap(raw)
  switch (e.type) {
    case 'JSXElement':
    case 'JSXFragment':
      return walkJsx(ctx, e, scope, tag, anchor)
    case 'ConditionalExpression':
      walkExpr(ctx, e.consequent, scope, tag, anchor)
      return walkExpr(ctx, e.alternate, scope, tag, anchor)
    case 'LogicalExpression':
      if (e.operator !== '&&') walkExpr(ctx, e.left, scope, tag, anchor)
      return walkExpr(ctx, e.right, scope, tag, anchor)
    case 'ArrowFunctionExpression':
    case 'FunctionExpression': {
      // A component's render function ({p => …}): its parameters are the store's data.
      const inner = new Map(scope)
      for (const p of e.params) bindData(inner, p)
      return walkBody(ctx, e, inner, tag, anchor)
    }
    case 'CallExpression': {
      const c = e.callee
      const fn = e.arguments[0]
      if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' && c.property.name === 'map' && fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')) {
        const inner = new Map(scope)
        const [item, index] = fn.params
        if (item) bindItems(inner, item, nodesOf(ctx, c.object, scope).flatMap(elementsOf))
        if (index) bindData(inner, index)
        walkBody(ctx, fn, inner, tag, anchor ?? e.start ?? undefined)
      }
      return
    }
    default:
      for (const n of nodesOf(ctx, e, scope)) if (strValue(n) != null) mark(ctx, n, 'text', TAG_LABEL[tag] ?? 'Text', anchor ?? e.start ?? 0)
  }
}

function walkJsx(ctx: Ctx, n: t.JSXElement | t.JSXFragment, scope: Scope, tag: string, anchor?: number) {
  let inner = tag
  if (n.type === 'JSXElement') {
    const nameNode = n.openingElement.name
    const name = nameNode.type === 'JSXIdentifier' ? nameNode.name : ''
    const component = /^[A-Z]/.test(name)
    for (const a of n.openingElement.attributes) {
      if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier' || !a.value) continue
      const an = a.name.name
      let nodes: t.Node[]
      if (a.value.type === 'StringLiteral') {
        nodes = [a.value]
        if (a.value.start != null) ctx.attrValues.add(a.value.start)
      } else if (a.value.type === 'JSXExpressionContainer' && a.value.expression.type !== 'JSXEmptyExpression') nodes = nodesOf(ctx, a.value.expression, scope)
      else continue
      const kind = attrKind(name, an, component)
      const label = kind === 'text' ? (PROP_LABEL[`${name}.${an}`] ?? TEXT_KEYS[an]) : kind ? KIND_LABEL[kind] : ''
      const at = anchor ?? a.start ?? 0
      for (const x of nodes) {
        if (kind && strValue(x) != null) mark(ctx, x, kind, label, at)
        else if (kind === 'text' && x.type === 'ArrayExpression') for (const el of elementsOf(x)) mark(ctx, el, 'text', label, at)
        else if (!kind && component && !SKIP_PROPS.has(an) && (x.type === 'ArrayExpression' || x.type === 'ObjectExpression')) walkData(ctx, x, at)
      }
    }
    inner = component ? (TAG_LABEL[name] ? name : tag) : name
  }
  for (const c of n.children) {
    if (c.type === 'JSXText') mark(ctx, c, 'text', TAG_LABEL[inner] ?? 'Text', anchor ?? c.start ?? 0)
    else if (c.type === 'JSXExpressionContainer') {
      if (c.expression.type !== 'JSXEmptyExpression') walkExpr(ctx, c.expression, scope, inner, anchor)
    } else if (c.type === 'JSXElement' || c.type === 'JSXFragment') walkJsx(ctx, c, scope, inner, anchor)
  }
}

const isFn = (n: t.Node): n is t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration =>
  n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'

function scan(source: string): Ctx | null {
  let file: t.File
  try {
    file = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }) as unknown as t.File
  } catch {
    return null
  }
  const ctx: Ctx = { found: new Map(), attrValues: new Set(), consts: new Map() }
  const fns: (t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration)[] = []
  const take = (st: t.VariableDeclaration, top: boolean) => {
    for (const d of st.declarations) {
      if (d.id.type !== 'Identifier' || !d.init) continue
      const init = unwrap(d.init)
      if (isFn(init)) {
        if (top) fns.push(init)
      } else ctx.consts.set(d.id.name, init)
    }
  }
  for (const st of file.program.body) {
    if (st.type === 'VariableDeclaration') take(st, true)
    else if (st.type === 'FunctionDeclaration') fns.push(st)
    else if (st.type === 'ExportDefaultDeclaration') {
      const d = unwrap(st.declaration)
      if (isFn(d)) fns.push(d)
    } else if (st.type === 'ExportNamedDeclaration' && st.declaration) {
      if (st.declaration.type === 'VariableDeclaration') take(st.declaration, true)
      else if (st.declaration.type === 'FunctionDeclaration') fns.push(st.declaration)
    }
  }
  for (const fn of fns) {
    if (fn.body.type !== 'BlockStatement') {
      walkExpr(ctx, fn.body, new Map(), '')
      continue
    }
    for (const st of fn.body.body) if (st.type === 'VariableDeclaration') take(st, false)
    for (const st of fn.body.body) if (st.type === 'ReturnStatement' && st.argument) walkExpr(ctx, st.argument, new Map(), '')
  }
  return ctx
}

/** A code section's editable literals, in source order (roughly top to bottom on the page). */
export function codeLiterals(source: string): CodeLiteral[] {
  const ctx = typeof source === 'string' ? scan(source) : null
  if (!ctx) return []
  return [...ctx.found.values()]
    .sort((a, b) => a.at - b.at || a.node.start! - b.node.start!)
    .slice(0, MAX_LITERALS)
    .map(f => ({ id: String(f.node.start), kind: f.kind, value: valueOf(f.node), label: f.label, line: f.node.loc?.start.line ?? 0 }))
}

/** The value to write for an edit, or a LiteralEditError saying what is wrong with it. */
function clean(kind: LiteralKind, raw: string): string {
  const v = String(raw ?? '')
  if (kind === 'link') {
    const s = v.trim()
    if (!isInternalLink(s) || s.length > 500) throw new LiteralEditError('Links go to a page of your store: start with / (like /products) or # for a part of this page.')
    return s
  }
  if (kind === 'image') {
    const s = v.trim()
    if (!safeSrc(s) || s.length > 2000) throw new LiteralEditError('Use a picture address starting with https:// or a /path on your store.')
    return s
  }
  const s = v.replace(/\s+/g, ' ').trim()
  if (kind === 'alt') {
    if (s.length > 200) throw new LiteralEditError('Keep the picture description under 200 characters.')
    return s
  }
  if (!s) throw new LiteralEditError('Text can’t be empty. To drop it, hide the section or ask the AI to change it.')
  if (s.length > 1000) throw new LiteralEditError('Keep the text under 1,000 characters.')
  return s
}

const escapeJsxText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')

/** The section's source with the edits written in. Throws LiteralEditError when an edit is stale or invalid. */
export function editCodeLiterals(source: string, edits: LiteralEdit[]): string {
  const ctx = scan(source)
  if (!ctx) throw new LiteralEditError('The section’s code has an error, so its words can’t be edited here. Ask the AI to fix it.')
  const byId = new Map([...ctx.found.values()].map(f => [String(f.node.start), f]))
  const last = new Map(edits.map(e => [e.id, e]))
  const changes: { start: number; end: number; text: string }[] = []
  for (const ed of last.values()) {
    const f = byId.get(ed.id)
    if (!f || valueOf(f.node) !== ed.from) throw new LiteralEditError('The section changed since it was opened. Reopen it and make the change again.')
    const to = clean(f.kind, ed.to)
    if (to === valueOf(f.node)) continue
    const n = f.node
    const start = n.start!
    const end = n.end!
    if (n.type === 'JSXText') {
      const raw = source.slice(start, end)
      const lead = raw.length - raw.trimStart().length
      const trail = raw.length - raw.trimEnd().length
      changes.push({ start: start + lead, end: end - trail, text: escapeJsxText(to) })
    } else if (ctx.attrValues.has(start)) changes.push({ start, end, text: /["&\\{}<>\r\n]/.test(to) ? `{${JSON.stringify(to)}}` : `"${to}"` })
    else changes.push({ start, end, text: JSON.stringify(to) })
  }
  let out = source
  for (const c of changes.sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + c.text + out.slice(c.end)
  return out
}
