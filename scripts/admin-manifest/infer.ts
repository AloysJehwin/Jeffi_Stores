// Request shape inference from how a handler uses its request: the JSON body, multipart fields and
// query parameters it reads, through destructuring, property reads, casts, zod, helpers and proxies.
import path from 'node:path'
import ts from 'typescript'
import type { JsonSchema } from '../../packages/cli/src/manifest-types'
import { type Mod, ROOT, findExport, literalSet, literalValue, loadMod, propKey, resolveName, resolveQualified, resolveSpec, unwrap } from './modules'
import { typeSchema } from './types'
import { conv, looksZod } from './zod'

type Lit = string | number | boolean
type Kind = 'req' | 'url' | 'sp' | 'form'
type Mode = 'json' | 'form' | 'query'

let nextId = 0

export class Shape {
  readonly id = ++nextId
  kind?: Kind
  /** For sp/form containers: the object of fields `.get(k)` reads. */
  fields?: Shape
  types = new Set<string>()
  /** Types used only when nothing stronger is known (`!!x`, the field's name). */
  weak = new Set<string>()
  props = new Map<string, Shape>()
  required = new Set<string>()
  items?: Shape
  /** Literals compared against (weak enum evidence). */
  lits = new Set<Lit>()
  /** Literals from `[..].includes(x)`, `SET.has(x)`, `x in OBJ`, `x !== a && x !== b` guards. */
  closed = new Set<Lit>()
  declared?: JsonSchema
  zod = false
  dflt?: Lit
  optional = false
  format?: string
  notes = new Set<string>()
  open = false
  /** Stored or forwarded whole (`JSON.stringify(body)`): any object. */
  freeform = false
  formField = false
  binary = false
  presence = false
  constructor(
    readonly parent?: Shape,
    readonly key?: string
  ) {}
  prop(k: string): Shape {
    let c = this.props.get(k)
    if (!c) this.props.set(k, (c = new Shape(this, k)))
    return c
  }
  item(): Shape {
    return (this.items ??= new Shape(this, '[]'))
  }
}

function container(kind: Kind, fields?: Shape): Shape {
  const s = new Shape()
  s.kind = kind
  s.fields = fields
  return s
}

export interface RequestInfo {
  json: Shape | null
  form: Shape | null
  query: Shape
  /** The body is read as text/bytes without JSON.parse, or forwarded. */
  rawBody: boolean
  /** Helpers that received the request but could not be followed. */
  unresolved: Set<string>
  proxy: 'documents' | 'messaging' | null
}

interface Run {
  out: RequestInfo
  method: string
  seen: Set<string>
  /** Functions that return the request body (`return req.json()`). */
  returns: Map<ts.Node, 'json' | 'form'>
  /** Literal arguments of the call being followed, by parameter. */
  bound: Map<ts.Node, string>
  /** Arguments of followed calls, by parameter (a zod schema passed to a validating helper). */
  boundExpr: Map<ts.Node, { expr: ts.Expression; mod: Mod }>
  /** Helpers that return (part of) a shape they were given: their call is that shape. */
  retShape: Map<ts.Node, Shape>
}

interface Cx {
  mod: Mod
  run: Run
  depth: number
}

// ── Scopes ───────────────────────────────────────────────────────────────────────────────────

type FnLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration

function isFnLike(n: ts.Node): n is FnLike {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
}

function bindingIds(b: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(b)) return [b]
  const out: ts.Identifier[] = []
  for (const el of b.elements) if (!ts.isOmittedExpression(el)) out.push(...bindingIds(el.name))
  return out
}

function declaresIn(c: ts.Node, name: string): ts.Identifier | null {
  const pick = (b: ts.BindingName | undefined) => (b ? bindingIds(b).find(i => i.text === name) ?? null : null)
  if (isFnLike(c)) {
    for (const p of c.parameters) {
      const h = pick(p.name)
      if (h) return h
    }
    return null
  }
  if (ts.isBlock(c) || ts.isSourceFile(c) || ts.isModuleBlock(c) || ts.isCaseClause(c) || ts.isDefaultClause(c)) {
    for (const st of c.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const h = pick(d.name)
          if (h) return h
        }
      } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) return st.name
    }
    return null
  }
  if ((ts.isForStatement(c) || ts.isForOfStatement(c) || ts.isForInStatement(c)) && c.initializer && ts.isVariableDeclarationList(c.initializer)) {
    for (const d of c.initializer.declarations) {
      const h = pick(d.name)
      if (h) return h
    }
  }
  if (ts.isCatchClause(c) && c.variableDeclaration) return pick(c.variableDeclaration.name)
  return null
}

/** The identifier that declares the name `ref` refers to (lexically), or null (import, global). */
function declaringId(ref: ts.Identifier): ts.Identifier | null {
  for (let n: ts.Node | undefined = ref.parent; n; n = n.parent) {
    const h = declaresIn(n, ref.text)
    if (h) return h
  }
  return null
}

function isReference(id: ts.Identifier): boolean {
  const p = id.parent
  if (!p) return false
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) return false
  if (ts.isBindingElement(p) && (p.propertyName === id || p.name === id)) return false
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)) && p.name === id) return false
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false
  return true
}

function referencesOf(decl: ts.Identifier): ts.Identifier[] {
  let scope: ts.Node | undefined = decl.parent
  while (scope && declaresIn(scope, decl.text) !== decl) scope = scope.parent
  if (!scope) return []
  const out: ts.Identifier[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === decl.text && n !== decl && isReference(n) && declaringId(n) === decl) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(scope)
  return out
}

/** A callee to its function (in-scope declaration, module local, import, namespace member). */
function resolveFn(expr: ts.Expression, mod: Mod): { fn: FnLike; mod: Mod } | null {
  const e = unwrap(expr)
  let hit: { mod: Mod; node: ts.Node } | null = null
  if (ts.isIdentifier(e)) {
    const d = declaringId(e)
    if (d) hit = { mod, node: d.parent }
    else hit = resolveName(e.text, mod)
  } else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    hit = resolveQualified(e.expression.text, e.name.text, mod)
    if (!hit) {
      const o = resolveName(e.expression.text, mod)
      const init = o && ts.isVariableDeclaration(o.node) && o.node.initializer ? unwrap(o.node.initializer) : null
      if (init && ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (p.name && propKey(p.name) === e.name.text) {
            if (ts.isMethodDeclaration(p)) return { fn: p, mod: o!.mod }
            if (ts.isPropertyAssignment(p)) {
              const v = unwrap(p.initializer)
              if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) return { fn: v, mod: o!.mod }
            }
          }
        }
      }
    }
  }
  if (!hit) return null
  const n = hit.node
  if (isFnLike(n) && n.body) return { fn: n, mod: hit.mod }
  if (ts.isVariableDeclaration(n) && n.initializer) {
    const i = unwrap(n.initializer)
    if ((ts.isArrowFunction(i) || ts.isFunctionExpression(i)) && i.body) return { fn: i, mod: hit.mod }
  }
  return null
}

// ── Handler functions ────────────────────────────────────────────────────────────────────────

function returnedFns(fn: FnLike, mod: Mod, member: string | null, depth: number): { fn: FnLike; mod: Mod }[] {
  if (!fn.body) return []
  if (!ts.isBlock(fn.body)) return member ? [] : fnsOfExpr(fn.body, mod, depth + 1)
  if (member) {
    for (const st of fn.body.statements) if (ts.isFunctionDeclaration(st) && st.name?.text === member) return [{ fn: st, mod }]
  }
  for (const st of fn.body.statements) {
    if (!ts.isReturnStatement(st) || !st.expression) continue
    const r = unwrap(st.expression)
    if (member && ts.isObjectLiteralExpression(r)) {
      for (const p of r.properties) {
        if (!p.name || propKey(p.name) !== member) continue
        if (ts.isMethodDeclaration(p)) return [{ fn: p, mod }]
        const v = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : null
        if (v) return fnsOfExpr(v, mod, depth + 1)
      }
    } else if (!member) return fnsOfExpr(r, mod, depth + 1)
  }
  return []
}

function fnsOfExpr(e0: ts.Expression, mod: Mod, depth: number): { fn: FnLike; mod: Mod }[] {
  if (depth > 6) return []
  const e = unwrap(e0)
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return [{ fn: e, mod }]
  if (ts.isIdentifier(e)) {
    const d = declaringId(e)
    if (d && d.parent && ts.isFunctionDeclaration(d.parent)) return [{ fn: d.parent, mod }]
    if (d && d.parent && ts.isVariableDeclaration(d.parent)) return fnsOf(d.parent, mod, depth + 1)
    const h = resolveName(e.text, mod)
    return h ? fnsOf(h.node, h.mod, depth + 1) : []
  }
  if (ts.isCallExpression(e)) {
    const fromArgs = e.arguments.flatMap(a => {
      const u = unwrap(a)
      return ts.isArrowFunction(u) || ts.isFunctionExpression(u) ? [{ fn: u as FnLike, mod }] : ts.isIdentifier(u) ? fnsOfExpr(u, mod, depth + 1) : []
    })
    if (fromArgs.length) return fromArgs
    const f = resolveFn(e.expression, mod)
    return f ? returnedFns(f.fn, f.mod, null, depth) : []
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const q = resolveQualified(e.expression.text, e.name.text, mod)
    if (q) return fnsOf(q.node, q.mod, depth + 1)
    const h = resolveName(e.expression.text, mod)
    if (h && ts.isVariableDeclaration(h.node) && h.node.initializer) {
      const init = unwrap(h.node.initializer)
      if (ts.isCallExpression(init)) {
        const f = resolveFn(init.expression, h.mod)
        if (f) return returnedFns(f.fn, f.mod, e.name.text, depth)
      }
      if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (!p.name || propKey(p.name) !== e.name.text) continue
          if (ts.isMethodDeclaration(p)) return [{ fn: p, mod: h.mod }]
          if (ts.isPropertyAssignment(p)) return fnsOfExpr(p.initializer, h.mod, depth + 1)
        }
      }
    }
  }
  return []
}

export function fnsOf(node: ts.Node, mod: Mod, depth = 0): { fn: FnLike; mod: Mod }[] {
  if (depth > 6) return []
  if (isFnLike(node) && node.body) return [{ fn: node, mod }]
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap(d => fnsOf(d, mod, depth + 1))
  if (ts.isVariableDeclaration(node) && node.initializer) return fnsOfExpr(node.initializer, mod, depth + 1)
  return []
}

// ── Document-service proxy (proxyAdminDocs forwards to its Next-style handlers) ───────────────

interface DocMount {
  method: string
  segs: string[]
  mod: Mod
  exp: string
}

let docMounts: DocMount[] | null = null

function loadDocMounts(): DocMount[] {
  if (docMounts) return docMounts
  docMounts = []
  const index = loadMod(path.join(ROOT, 'document-service/src/admin/index.ts'))
  if (!index) return docMounts
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'mount' && n.arguments.length === 4) {
      const [, m, p, h] = n.arguments
      if (ts.isStringLiteral(m) && ts.isStringLiteral(p) && ts.isPropertyAccessExpression(h) && ts.isIdentifier(h.expression)) {
        const imp = index.imports.get(h.expression.text)
        const file = imp && resolveSpec(imp.spec, index.file)
        const mod = file && loadMod(file)
        if (mod) docMounts!.push({ method: m.text, segs: p.text.split('/').filter(Boolean), mod, exp: h.name.text })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(index.sf)
  return docMounts
}

function pathPattern(e: ts.Expression, mod: Mod): string[] | null {
  const u = unwrap(e)
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text.split('?')[0].split('/').filter(Boolean)
  if (ts.isTemplateExpression(u)) {
    let s = u.head.text
    for (const sp of u.templateSpans) s += '\u0000' + sp.literal.text
    return s.split('?')[0].split('/').filter(Boolean).map(x => (x.includes('\u0000') ? '*' : x))
  }
  const v = literalValue(u, mod)
  return typeof v === 'string' ? v.split('/').filter(Boolean) : null
}

function docsProxy(call: ts.CallExpression, req: Shape, cx: Cx) {
  cx.run.out.proxy = 'documents'
  const segs = call.arguments[1] ? pathPattern(call.arguments[1], cx.mod) : null
  const hit = segs && loadDocMounts().find(m => m.method === cx.run.method && m.segs.length === segs.length && m.segs.every((s, i) => s === segs[i] || (s.startsWith(':') && segs[i] !== undefined)))
  const target = hit && findExport(hit.mod, hit.exp)
  if (!target) {
    cx.run.out.unresolved.add(`proxyAdminDocs ${segs?.join('/') ?? '?'}`)
    return
  }
  for (const f of fnsOf(target.node, target.mod)) {
    const p = f.fn.parameters[0]
    if (p) bindTarget(p.name, req, { mod: f.mod, run: cx.run, depth: cx.depth + 1 })
  }
}

// ── Usage ────────────────────────────────────────────────────────────────────────────────────

const STRING_METHODS = new Set(['trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'split', 'startsWith', 'endsWith', 'replace', 'replaceAll', 'match', 'matchAll', 'padStart', 'padEnd', 'charAt', 'charCodeAt', 'codePointAt', 'localeCompare', 'normalize', 'substring', 'substr', 'search', 'repeat'])
const ARRAY_METHODS = new Set(['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast', 'flatMap', 'reduce', 'join', 'sort', 'flat'])
const CALLBACK_METHODS = new Set(['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast', 'flatMap', 'reduce', 'sort'])
const FILE_PROPS = new Set(['size', 'name', 'type', 'lastModified'])
const FILE_METHODS = new Set(['arrayBuffer', 'stream', 'text', 'slice', 'bytes'])
const ZOD_PARSE = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync'])
const NUMBER_FNS = /^(Number|parseFloat|Number\.parseFloat|Math\.(round|floor|ceil|abs|trunc|max|min|sign))$/
const INTEGER_FNS = /^(parseInt|Number\.parseInt|Number\.isInteger|Number\.isSafeInteger|BigInt)$/
// Helpers that take the request for auth, headers or cookies only.
const SKIP_REQ = /^(authenticate\w*|requireAdminScope|requireStaff|requireAdmin\w*|verifyCron\w*|extractSessionSignals|reqMeta|isSameOriginRequest|recordFailedLogin|epochFrom|getClientIp|clientIp|ipOf|getIp|rateLimit\w*|checkRateLimit|audit\w*|logAdminAction|driveActor|actorOf|getTenant\w*|resolveTenant\w*|isPlatformAdmin|isPlatformOwner|hasScope|aiDenial|adminFor|ownerApi|channelAdmin|readReferralCookie|attributionFromRequest|adsConsentFromRequest|metaClicksFromRequest)$/

/** An identifier bound to a local `const x = <init>` resolves to its initializer. */
function local(e: ts.Expression): ts.Expression {
  const u = unwrap(e)
  if (!ts.isIdentifier(u)) return u
  const d = declaringId(u)
  return d && ts.isVariableDeclaration(d.parent) && d.parent.initializer && d.parent.name === d ? local(d.parent.initializer) : u
}

const isLit = (v: unknown): v is Lit => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
const litType = (v: Lit) => (typeof v === 'number' ? 'number' : typeof v)

function markRequired(s: Shape, at: ts.Node) {
  if (!s.parent || !s.key || s.key === '[]' || conditionallyPresent(at, s.key)) return
  s.parent.required.add(s.key)
}

/** The guard sits inside a branch that already tested the field (`if (body.x !== undefined) { if (!valid(body.x)) … }`). */
function conditionallyPresent(at: ts.Node, key: string): boolean {
  let g: ts.Node | undefined = at
  while (g && !ts.isIfStatement(g)) g = g.parent
  if (!g) return false
  const re = new RegExp(`(\\.|\\b|['"])${key.replace(/[^\w$]/g, '')}\\b`)
  for (let c: ts.Node = g, a = g.parent; a; c = a, a = a.parent) {
    if (isFnLike(a)) return false
    const cond = ts.isIfStatement(a) && a.expression !== c ? a.expression : ts.isConditionalExpression(a) && a.condition !== c ? a.condition : null
    if (cond) {
      const t = cond.getText().replace(/\?\./g, '.')
      if (!t.startsWith('!') && re.test(t)) return true
    }
  }
  return false
}

function binary(s: Shape) {
  s.binary = true
}

// An exit that rejects the request (4xx response, error value, throw), not one returning a default.
const REJECTS = /status:\s*4\d\d|\b4(00|22)\b|error|invalid|required|missing|must|bad ?request|not allowed|unsupported/i

function exits(st: ts.Statement): boolean {
  const rejects = (x: ts.Statement) => ts.isThrowStatement(x) || (ts.isReturnStatement(x) && !!x.expression && REJECTS.test(x.expression.getText()))
  if (rejects(st)) return true
  if (ts.isBlock(st)) return st.statements.some(rejects)
  return false
}

/** `n` is (a disjunct of) an `if` condition whose branch returns or throws. */
function exitGuard(n: ts.Node): boolean {
  let c = n
  while (c.parent && (ts.isParenthesizedExpression(c.parent) || (ts.isBinaryExpression(c.parent) && c.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken))) c = c.parent
  const p = c.parent
  return !!p && ts.isIfStatement(p) && p.expression === c && exits(p.thenStatement)
}

/** `x !== 'a' && x !== 'b'` as an exiting `if` condition. */
function negChainGuard(n: ts.Node): boolean {
  let c = n
  while (c.parent && (ts.isParenthesizedExpression(c.parent) || (ts.isBinaryExpression(c.parent) && c.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))) c = c.parent
  const p = c.parent
  return !!p && ts.isIfStatement(p) && p.expression === c && exits(p.thenStatement)
}

function negatedGuard(n: ts.Node): boolean {
  let p = n.parent
  while (p && ts.isParenthesizedExpression(p)) p = p.parent
  return !!p && ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken && exitGuard(p)
}

function applyDeclared(s: Shape, t: ts.TypeNode | undefined, mod: Mod) {
  if (!t || s.kind) return
  const r = typeSchema(t, mod)
  if (!r) return
  if (r.optional) s.optional = true
  s.declared = s.declared && !s.zod ? mergeDeclared(s.declared, r.s) : s.declared ?? r.s
}

function mergeDeclared(a: JsonSchema, b: JsonSchema): JsonSchema {
  if (a.properties && b.properties) return { ...a, ...b, properties: { ...(a.properties as object), ...(b.properties as object) } }
  return Object.keys(b).length > Object.keys(a).length ? b : a
}

function applyZod(s: Shape, schema: ts.Expression, mod: Mod) {
  const c = conv(schema, mod)
  if (!c) return
  s.declared = c.s
  s.zod = true
}

function setDefault(c: Shape, init: ts.Expression, mod: Mod) {
  c.optional = true
  const u = unwrap(init)
  const v = literalValue(u, mod)
  if (isLit(v)) {
    if (c.dflt === undefined) c.dflt = v
    c.types.add(litType(v))
  } else if (ts.isArrayLiteralExpression(u)) c.types.add('array')
  else if (ts.isObjectLiteralExpression(u)) c.types.add('object')
}

function bindTarget(name: ts.BindingName, s: Shape, cx: Cx, t?: ts.TypeNode) {
  applyDeclared(s, t, cx.mod)
  if (ts.isIdentifier(name)) {
    for (const r of referencesOf(name)) useExpr(r, s, cx)
    return
  }
  if (ts.isObjectBindingPattern(name)) {
    for (const el of name.elements) {
      if (el.dotDotDotToken) {
        if (!s.kind) s.open = true
        bindTarget(el.name, s, cx)
        continue
      }
      const key = el.propertyName ? propKey(el.propertyName) : ts.isIdentifier(el.name) ? el.name.text : null
      const c = key ? member(s, key, cx) : null
      if (!c) continue
      if (el.initializer && !c.kind) setDefault(c, el.initializer, cx.mod)
      bindTarget(el.name, c, cx)
    }
    return
  }
  if (s.kind) return
  s.types.add('array')
  for (const el of name.elements) if (ts.isBindingElement(el)) bindTarget(el.name, s.item(), cx)
}

/** `s.key`, or the sub-object a request/URL exposes under that key. */
function member(s: Shape, key: string, cx: Cx): Shape | null {
  switch (s.kind) {
    case 'req':
      return key === 'nextUrl' ? container('url') : null
    case 'url':
      return key === 'searchParams' ? container('sp', cx.run.out.query) : null
    case 'sp':
    case 'form':
      return null
  }
  s.types.add('object')
  return s.prop(key)
}

function useExpr(e: ts.Expression, s: Shape, cx: Cx, d = 0): void {
  if (d > 40) return
  const p = e.parent
  if (!p) return
  if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAwaitExpression(p)) return useExpr(p, s, cx, d + 1)
  if (ts.isAsExpression(p) || ts.isTypeAssertionExpression(p) || ts.isSatisfiesExpression(p)) {
    applyDeclared(s, p.type, cx.mod)
    return useExpr(p, s, cx, d + 1)
  }
  if (s.kind) return containerUse(e, p, s, cx, d)
  if (ts.isPropertyAccessExpression(p) && p.expression === e) {
    const name = p.name.text
    const call = ts.isCallExpression(p.parent) && p.parent.expression === p ? p.parent : null
    if (call) return methodUse(s, name, call, cx)
    if (s.formField && FILE_PROPS.has(name)) return binary(s)
    if (name === 'length') return lengthUse(p, s, cx)
    s.types.add('object')
    return useExpr(p, s.prop(name), cx, d + 1)
  }
  if (ts.isElementAccessExpression(p) && p.expression === e) {
    const k = p.argumentExpression
    if (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) {
      s.types.add('object')
      return useExpr(p, s.prop(k.text), cx, d + 1)
    }
    if (ts.isNumericLiteral(k)) {
      s.types.add('array')
      return useExpr(p, s.item(), cx, d + 1)
    }
    s.open = true
    return
  }
  if (ts.isCallExpression(p) && p.expression !== e) {
    const i = p.arguments.indexOf(e)
    if (i >= 0) return argUse(s, p, i, cx)
    return
  }
  if (ts.isNewExpression(p)) {
    const c = p.expression.getText(cx.mod.sf)
    if (c === 'Date') {
      s.types.add('string')
      s.format ??= 'date-time'
    } else if (c === 'URL') {
      s.types.add('string')
      s.format ??= 'uri'
    } else if (c === 'Set') s.types.add('array')
    return
  }
  if (ts.isVariableDeclaration(p) && p.initializer === e) return bindTarget(p.name, s, cx, p.type)
  if (ts.isBinaryExpression(p)) return binaryUse(e, p, s, cx, d)
  if (ts.isPrefixUnaryExpression(p)) {
    const pp = p.parent
    if (p.operator === ts.SyntaxKind.ExclamationToken && ts.isPrefixUnaryExpression(pp) && pp.operator === ts.SyntaxKind.ExclamationToken) s.weak.add('boolean')
    else if (p.operator === ts.SyntaxKind.ExclamationToken && exitGuard(p)) markRequired(s, p)
    else if (p.operator === ts.SyntaxKind.PlusToken || p.operator === ts.SyntaxKind.MinusToken) s.types.add('number')
    return
  }
  if (ts.isTypeOfExpression(p)) return typeofUse(p, s)
  if (ts.isForOfStatement(p) && p.expression === e) {
    s.types.add('array')
    const init = p.initializer
    if (ts.isVariableDeclarationList(init) && init.declarations[0]) bindTarget(init.declarations[0].name, s.item(), cx)
    return
  }
  if (ts.isForInStatement(p) && p.expression === e) {
    s.types.add('object')
    s.open = true
    return
  }
  if (ts.isSpreadElement(p)) {
    if (ts.isArrayLiteralExpression(p.parent)) s.types.add('array')
    return
  }
  if (ts.isSpreadAssignment(p)) {
    s.types.add('object')
    return
  }
  if (ts.isSwitchStatement(p) && p.expression === e) {
    for (const c of p.caseBlock.clauses) {
      if (!ts.isCaseClause(c)) continue
      const v = literalValue(c.expression, cx.mod)
      if (isLit(v)) {
        s.lits.add(v)
        s.types.add(litType(v))
      }
    }
    return
  }
  if (ts.isConditionalExpression(p) && p.condition !== e) return useExpr(p, s, cx, d + 1)
  if ((ts.isPropertyAssignment(p) && p.initializer === e) || ts.isShorthandPropertyAssignment(p)) return objectFlow(p, s, cx)
  if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === e)) {
    let fn: ts.Node | undefined = p
    while (fn && !isFnLike(fn)) fn = fn.parent
    if (fn && !cx.run.retShape.has(fn)) cx.run.retShape.set(fn, s)
  }
}

function lengthUse(pa: ts.PropertyAccessExpression, s: Shape, cx: Cx) {
  let p = pa.parent
  while (p && ts.isParenthesizedExpression(p)) p = p.parent
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken && exitGuard(p)) markRequired(s, p)
  else if (ts.isBinaryExpression(p) && exitGuard(p)) {
    const v = literalValue(p.left === pa ? p.right : p.left, cx.mod)
    const op = p.operatorToken.kind
    if ((v === 0 && (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken)) || (v === 1 && op === ts.SyntaxKind.LessThanToken)) markRequired(s, p)
  }
}

function methodUse(s: Shape, name: string, call: ts.CallExpression, cx: Cx) {
  if (s.formField && FILE_METHODS.has(name)) return binary(s)
  if (STRING_METHODS.has(name)) {
    s.types.add('string')
    if (name === 'split' && call.arguments[0] && literalValue(call.arguments[0], cx.mod) === ',') s.notes.add('comma-separated list')
    if (name === 'trim' && negatedGuard(call)) markRequired(s, call)
    return
  }
  if (ARRAY_METHODS.has(name)) {
    s.types.add('array')
    const cb = call.arguments[0] && unwrap(call.arguments[0])
    if (cb && CALLBACK_METHODS.has(name) && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
      const prm = cb.parameters[name === 'reduce' ? 1 : 0]
      if (prm) bindTarget(prm.name, s.item(), cx, prm.type)
    } else if (cb && ts.isIdentifier(cb) && CALLBACK_METHODS.has(name)) {
      if (cb.text === 'Number') s.item().types.add('number')
      else if (cb.text !== 'String' && cb.text !== 'Boolean') followCall(call, 0, s.item(), cx, cb)
    }
    return
  }
  if (name === 'toFixed' || name === 'toPrecision') s.types.add('number')
  else if (name === 'hasOwnProperty') s.types.add('object')
}

function typeofUse(p: ts.TypeOfExpression, s: Shape) {
  let b: ts.Node = p.parent
  while (b && ts.isParenthesizedExpression(b)) b = b.parent
  if (!ts.isBinaryExpression(b)) return
  const other = b.left === p ? b.right : b.left
  if (!ts.isStringLiteral(other)) return
  const op = b.operatorToken.kind
  const neg = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken
  if (other.text === 'undefined') {
    if (!neg && exitGuard(b)) markRequired(s, b)
    return
  }
  const jt = ({ string: 'string', number: 'number', boolean: 'boolean', object: 'object', bigint: 'integer' } as Record<string, string>)[other.text]
  if (!jt) return
  s.types.add(jt)
  if (neg && exitGuard(b)) markRequired(s, b)
}

function binaryUse(e: ts.Expression, p: ts.BinaryExpression, s: Shape, cx: Cx, d: number) {
  const op = p.operatorToken.kind
  const K = ts.SyntaxKind
  const other = p.left === e ? p.right : p.left
  if ((op === K.QuestionQuestionToken || op === K.BarBarToken) && p.left === e) {
    s.optional = true
    const v = literalValue(p.right, cx.mod)
    if (isLit(v)) {
      if (s.dflt === undefined && v !== '') s.dflt = v
      s.types.add(litType(v))
    } else if (ts.isArrayLiteralExpression(unwrap(p.right))) s.types.add('array')
    return useExpr(p, s, cx, d + 1)
  }
  if ((op === K.QuestionQuestionToken || op === K.BarBarToken || op === K.AmpersandAmpersandToken) && p.right === e) return useExpr(p, s, cx, d + 1)
  if (op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken || op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken) {
    const neg = op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken
    const u = unwrap(other)
    if (u.kind === K.NullKeyword || (ts.isIdentifier(u) && u.text === 'undefined')) {
      if (!neg && exitGuard(p)) markRequired(s, p)
      return
    }
    const v = literalValue(local(u), cx.mod)
    if (!isLit(v)) return
    s.types.add(litType(v))
    if (neg && negChainGuard(p)) {
      s.closed.add(v)
      markRequired(s, p)
    } else s.lits.add(v)
    return
  }
  if ([K.LessThanToken, K.GreaterThanToken, K.LessThanEqualsToken, K.GreaterThanEqualsToken, K.MinusToken, K.AsteriskToken, K.SlashToken, K.PercentToken, K.AsteriskAsteriskToken].includes(op)) {
    s.types.add('number')
    return
  }
  if (op === K.EqualsToken && p.right === e && ts.isIdentifier(p.left)) {
    const decl = declaringId(p.left)
    const key = decl && `assign:${decl.pos}:${s.id}`
    if (!decl || cx.run.seen.has(key!)) return
    cx.run.seen.add(key!)
    if (ts.isVariableDeclaration(decl.parent)) applyDeclared(s, decl.parent.type, cx.mod)
    for (const r of referencesOf(decl)) {
      const rp = r.parent
      if (ts.isBinaryExpression(rp) && rp.left === r && rp.operatorToken.kind === K.EqualsToken) continue
      useExpr(r, s, cx, d + 1)
    }
    return
  }
  if (op === K.InKeyword && p.left === e) {
    const keys = literalSet(local(p.right), cx.mod, true)
    if (keys) for (const k of keys) s.closed.add(k)
    s.types.add('string')
    return
  }
  if (op === K.InstanceOfKeyword && p.left === e) {
    const t = p.right.getText(cx.mod.sf)
    if (t === 'File' || t === 'Blob') binary(s)
    else if (t === 'Array') s.types.add('array')
  }
}

/** A schema expression; a parameter resolves to the argument of the call being followed. */
function schemaExpr(e: ts.Expression, cx: Cx): { expr: ts.Expression; mod: Mod } {
  const u = unwrap(e)
  const d = ts.isIdentifier(u) ? declaringId(u) : null
  const b = d && ts.isParameter(d.parent) ? cx.run.boundExpr.get(d.parent) : undefined
  return b ?? { expr: e, mod: cx.mod }
}

function argUse(s: Shape, call: ts.CallExpression, idx: number, cx: Cx) {
  const callee = unwrap(call.expression)
  const ctext = callee.getText(cx.mod.sf)
  if (ts.isPropertyAccessExpression(callee) && ZOD_PARSE.has(callee.name.text)) {
    const z = schemaExpr(callee.expression, cx)
    if (looksZod(z.expr, z.mod)) return applyZod(s, z.expr, z.mod)
  }
  if (/(^|\.)parseBody$/.test(ctext) && idx === 1 && call.arguments[0]) return applyZod(s, call.arguments[0], cx.mod)
  if (INTEGER_FNS.test(ctext)) {
    s.types.add('integer')
    if (negatedGuard(call)) markRequired(s, call)
    return
  }
  if (NUMBER_FNS.test(ctext)) {
    s.types.add('number')
    return
  }
  if (/^(Number\.isFinite|isFinite)$/.test(ctext)) {
    s.types.add('number')
    if (negatedGuard(call)) markRequired(s, call)
    return
  }
  if (/^(Number\.isNaN|isNaN)$/.test(ctext)) {
    s.types.add('number')
    if (exitGuard(call)) markRequired(s, call)
    return
  }
  switch (ctext) {
    case 'String':
    case 'encodeURIComponent':
      s.types.add('string')
      return
    case 'JSON.stringify':
      s.freeform = true
      return
    case 'Boolean':
    case 'console.log':
    case 'console.error':
    case 'console.warn':
      return
    case 'Array.isArray': {
      // `!Array.isArray(x)` rejecting → an array; `if (… || Array.isArray(x)) return` or `x && !Array.isArray(x)` → not one.
      let n: ts.Node = call.parent
      while (ts.isParenthesizedExpression(n)) n = n.parent
      const negated = ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken
      if (negated ? negatedGuard(call) : !exitGuard(call)) s.types.add('array')
      if (negatedGuard(call)) markRequired(s, call)
      return
    }
    case 'Object.keys':
    case 'Object.values':
    case 'Object.entries':
      s.types.add('object')
      s.open = true
      return
    case 'JSON.parse':
      s.types.add('string')
      s.notes.add('JSON-encoded')
      return
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const m = callee.name.text
    if (m === 'test' && idx === 0) {
      s.types.add('string')
      const re = callee.expression.getText(cx.mod.sf)
      if (/0-9a-f\]\{8\}/i.test(re) || /uuid/i.test(re)) s.format ??= 'uuid'
      else if (/email/i.test(re) || /@/.test(re)) s.format ??= 'email'
      if (negatedGuard(call)) markRequired(s, call)
      return
    }
    if ((m === 'includes' || m === 'has') && idx === 0) {
      const set = literalSet(local(callee.expression), cx.mod)
      if (set) {
        for (const v of set) s.closed.add(v)
        s.types.add(typeof set[0] === 'number' ? 'number' : 'string')
        if (negatedGuard(call)) markRequired(s, call)
      }
      return
    }
    if (m === 'push' || m === 'add' || m === 'set' || m === 'append' || m === 'query' || m === 'json' || m === 'log' || m === 'error' || m === 'warn') return
  }
  const fname = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  if (/^(is|valid)(Valid)?(Uuid|UUID)$/.test(fname) || /^isUuid/i.test(fname)) {
    s.types.add('string')
    s.format = 'uuid'
    if (negatedGuard(call)) markRequired(s, call)
    return
  }
  if (/^(is|valid)\w*Email$/i.test(fname)) {
    s.types.add('string')
    s.format = 'email'
    if (negatedGuard(call)) markRequired(s, call)
    return
  }
  followCall(call, idx, s, cx)
}

/** `{ k: s }` passed to a typed parameter: the parameter's property type describes s. */
function objectFlow(pa: ts.PropertyAssignment | ts.ShorthandPropertyAssignment, s: Shape, cx: Cx) {
  const key = pa.name && propKey(pa.name)
  let ol: ts.Node = pa.parent
  let p = ol.parent
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p))) {
    ol = p
    p = p.parent
  }
  if (!key || !p || !ts.isCallExpression(p)) return
  const i = p.arguments.indexOf(ol as ts.Expression)
  const callee = unwrap(p.expression)
  const zodSchema =
    ts.isPropertyAccessExpression(callee) && ZOD_PARSE.has(callee.name.text) && i === 0 && looksZod(callee.expression, cx.mod)
      ? callee.expression
      : /(^|\.)parseBody$/.test(callee.getText(cx.mod.sf)) && i === 1
        ? p.arguments[0]
        : null
  if (zodSchema) {
    const z = conv(zodSchema, cx.mod)
    const sub = (z?.s.properties as Record<string, JsonSchema> | undefined)?.[key]
    if (sub) s.declared = sub
    return
  }
  const t = i >= 0 ? resolveFn(p.expression, cx.mod) : null
  const prm = t?.fn.parameters[i]
  if (!prm?.type) return
  const ps = typeSchema(prm.type, t!.mod)
  const sub = (ps?.s.properties as Record<string, JsonSchema> | undefined)?.[key]
  if (sub && !s.declared) s.declared = sub
}

function followCall(call: ts.CallExpression, idx: number, s: Shape, cx: Cx, calleeExpr: ts.Expression = call.expression) {
  if (cx.depth > 4) return
  const t = resolveFn(calleeExpr, cx.mod)
  if (!t) {
    if (s.kind === 'req') cx.run.out.unresolved.add(calleeExpr.getText(cx.mod.sf).slice(0, 60))
    return
  }
  const prm = t.fn.parameters[idx]
  if (prm && !prm.dotDotDotToken) {
    call.arguments.forEach((a, i) => {
      const v = literalValue(a, cx.mod)
      const tp = t.fn.parameters[i]
      if (tp) cx.run.boundExpr.set(tp, { expr: a, mod: cx.mod })
      if (typeof v === 'string' && tp) {
        cx.run.bound.set(tp, v)
      }
    })
    const key = `${t.mod.file}:${t.fn.pos}:${idx}:${s.id}:${call.arguments.map(a => a.getText(cx.mod.sf)).join('|')}`
    if (!cx.run.seen.has(key)) {
      cx.run.seen.add(key)
      cx.run.retShape.delete(t.fn)
      bindTarget(prm.name, s, { mod: t.mod, run: cx.run, depth: cx.depth + 1 }, prm.type)
      const r = cx.run.retShape.get(t.fn)
      if (r) cx.run.retShape.set(call, r)
    }
  }
  const ret = cx.run.retShape.get(call)
  if (ret && !ret.kind && cx.depth < 4) {
    cx.run.retShape.delete(call)
    useExpr(call, ret, { ...cx, depth: cx.depth + 1 })
  }
  if (s.kind === 'req') {
    const kind = cx.run.returns.get(t.fn) ?? (t.fn.type && /\bFormData\b/.test(t.fn.type.getText(t.mod.sf)) ? 'form' : undefined)
    if (kind) climbSource(call, kind, cx)
  }
}

function containerUse(e: ts.Expression, p: ts.Node, s: Shape, cx: Cx, d: number): void {
  const out = cx.run.out
  if (ts.isPropertyAccessExpression(p) && p.expression === e) {
    const name = p.name.text
    const call = ts.isCallExpression(p.parent) && p.parent.expression === p ? p.parent : null
    if (s.kind === 'req') {
      if (call && name === 'json') return climbSource(call, 'json', cx)
      if (call && name === 'formData') return climbSource(call, 'form', cx)
      if (call && name === 'text') return textSource(call, cx)
      if (call && (name === 'arrayBuffer' || name === 'blob')) {
        out.rawBody = true
        return
      }
      if (call && name === 'clone') return useExpr(call, s, cx, d + 1)
      if (name === 'nextUrl') return useExpr(p, container('url'), cx, d + 1)
      if (name === 'url') {
        const np = p.parent
        if (ts.isNewExpression(np) && np.expression.getText(cx.mod.sf) === 'URL' && np.arguments?.[0] === p) return useExpr(np, container('url'), cx, d + 1)
        return
      }
      if (name === 'body') out.rawBody = true
      return
    }
    if (s.kind === 'url') {
      if (name === 'searchParams') return useExpr(p, container('sp', out.query), cx, d + 1)
      return
    }
    if (!call || !s.fields) return
    if (name === 'get' || name === 'getAll' || name === 'has') {
      const keys = call.arguments[0] ? keyNames(call.arguments[0], cx) : null
      if (!keys) {
        s.fields.open = true
        return
      }
      for (const k of keys) fieldUse(name, call, s.fields.prop(k), s.kind!, cx, d)
      return
    }
    if (name === 'entries' && ts.isCallExpression(call.parent) && call.parent.expression.getText(cx.mod.sf) === 'Object.fromEntries') return useExpr(call.parent, s.fields, cx, d + 1)
    if (['entries', 'keys', 'values', 'forEach', 'toString'].includes(name)) s.fields.open = true
    return
  }
  if (ts.isCallExpression(p) && p.expression !== e) {
    const i = p.arguments.indexOf(e)
    if (i < 0) return
    const ctext = unwrap(p.expression).getText(cx.mod.sf)
    const name = ctext.split('.').pop()!
    if ((s.kind === 'sp' || s.kind === 'form') && ctext === 'Object.fromEntries') return useExpr(p, s.fields!, cx, d + 1)
    if (s.kind === 'req') {
      if (name === 'proxyAdminDocs' || name === 'proxyUserOrAdminDocs') return docsProxy(p, s, cx)
      if (name === 'proxyAdminMessaging' || name === 'proxyUserMessaging') {
        out.proxy = 'messaging'
        out.unresolved.add(name)
        return
      }
      if (SKIP_REQ.test(name)) return
    }
    if (s.kind === 'url' && ctext === 'URL') return
    return followCall(p, i, s, cx)
  }
  if (ts.isVariableDeclaration(p) && p.initializer === e) return bindTarget(p.name, s, cx)
  if (ts.isNewExpression(p) && (s.kind === 'sp' || s.kind === 'form') && /URLSearchParams/.test(p.expression.getText(cx.mod.sf))) return useExpr(p, s, cx, d + 1)
  if ((ts.isForOfStatement(p) && p.expression === e) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) {
    if (s.fields) s.fields.open = true
  }
}

function fieldUse(name: string, call: ts.CallExpression, f: Shape, kind: Kind, cx: Cx, d: number) {
  if (kind === 'form') f.formField = true
  if (name === 'get') return useExpr(call, f, cx, d + 1)
  if (name === 'getAll') {
    f.types.add('array')
    const it = f.item()
    if (kind === 'form') it.formField = true
    else it.types.add('string')
    return useExpr(call, f, cx, d + 1)
  }
  f.optional = true
  if (kind === 'sp') f.presence = true
}

/** Literal keys of `sp.get(k)`: a literal, a const, a loop over a literal array, or a local helper's parameter. */
function keyNames(k: ts.Expression, cx: Cx): string[] | null {
  const u = unwrap(k)
  const v = literalValue(u, cx.mod)
  if (typeof v === 'string') return [v]
  if (!ts.isIdentifier(u)) return null
  const decl = declaringId(u)
  if (!decl) return null
  const dp = decl.parent
  if (ts.isVariableDeclaration(dp) && ts.isVariableDeclarationList(dp.parent) && ts.isForOfStatement(dp.parent.parent)) {
    const set = literalSet(dp.parent.parent.expression, cx.mod)
    return set ? set.map(String) : null
  }
  if (!ts.isParameter(dp) || !isFnLike(dp.parent)) return null
  const bound = cx.run.bound.get(dp)
  if (bound) return [bound]
  const fn = dp.parent
  const idx = fn.parameters.indexOf(dp)
  const nameId = ts.isFunctionDeclaration(fn) ? fn.name : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name : null
  if (!nameId) return null
  const out: string[] = []
  for (const r of referencesOf(nameId)) {
    const c = r.parent
    if (ts.isCallExpression(c) && c.expression === r && c.arguments[idx]) {
      const lv = literalValue(c.arguments[idx], cx.mod)
      if (typeof lv === 'string') out.push(lv)
    }
  }
  return out.length ? [...new Set(out)] : null
}

/** From `req.json()` (or a helper returning it) up through await/catch/casts to what receives it. */
function climbSource(start: ts.Expression, kind: 'json' | 'form', cx: Cx) {
  const out = cx.run.out
  let e: ts.Expression = start
  let declared: ts.TypeNode | undefined
  for (;;) {
    const p: ts.Node = e.parent
    if (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p)) e = p
    else if (ts.isAsExpression(p) || ts.isTypeAssertionExpression(p) || ts.isSatisfiesExpression(p)) {
      declared = p.type
      e = p
    } else if (ts.isPropertyAccessExpression(p) && p.expression === e && p.name.text === 'catch' && ts.isCallExpression(p.parent) && p.parent.expression === p) e = p.parent
    else if (ts.isBinaryExpression(p) && p.left === e && (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) e = p
    else if (ts.isConditionalExpression(p) && (p.whenTrue === e || p.whenFalse === e)) e = p
    else break
  }
  const root = kind === 'json' ? (out.json ??= new Shape()) : (out.form ??= new Shape())
  const target = kind === 'json' ? root : container('form', root)
  if (declared) applyDeclared(root, declared, cx.mod)
  const p = e.parent
  if (ts.isVariableDeclaration(p) && p.initializer === e) return bindTarget(p.name, target, cx, p.type)
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === e && ts.isIdentifier(p.left)) {
    const decl = declaringId(p.left)
    if (!decl) return
    if (ts.isVariableDeclaration(decl.parent)) applyDeclared(root, decl.parent.type, cx.mod)
    for (const r of referencesOf(decl)) if (r !== p.left) useExpr(r, target, cx)
    return
  }
  if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === e)) {
    let fn: ts.Node | undefined = p
    while (fn && !isFnLike(fn)) fn = fn.parent
    if (fn) cx.run.returns.set(fn, kind)
    return
  }
  if (ts.isSpreadAssignment(p)) {
    root.open = true
    return
  }
  useExpr(e, target, cx)
}

function textSource(call: ts.CallExpression, cx: Cx) {
  let e: ts.Expression = call
  while (ts.isAwaitExpression(e.parent) || ts.isParenthesizedExpression(e.parent)) e = e.parent
  const isParse = (n: ts.Node) => ts.isCallExpression(n) && n.expression.getText(cx.mod.sf) === 'JSON.parse'
  if (isParse(e.parent)) return climbSource(e.parent as ts.CallExpression, 'json', cx)
  let parsed = false
  if (ts.isVariableDeclaration(e.parent) && ts.isIdentifier(e.parent.name)) {
    for (const r of referencesOf(e.parent.name)) {
      if (isParse(r.parent)) {
        parsed = true
        climbSource(r.parent as ts.CallExpression, 'json', cx)
      }
    }
  }
  if (!parsed) cx.run.out.rawBody = true
}

// ── Entry ────────────────────────────────────────────────────────────────────────────────────

export function inferRequest(node: ts.Node, mod: Mod, method: string): RequestInfo {
  const out: RequestInfo = { json: null, form: null, query: new Shape(), rawBody: false, unresolved: new Set(), proxy: null }
  const run: Run = { out, method, seen: new Set(), returns: new Map(), bound: new Map(), boundExpr: new Map(), retShape: new Map() }
  const req = container('req')
  for (const f of fnsOf(node, mod)) {
    const p = f.fn.parameters[0]
    if (p) bindTarget(p.name, req, { mod: f.mod, run, depth: 0 })
  }
  return out
}

// ── Shape → JSON Schema ──────────────────────────────────────────────────────────────────────

const isEmptySchema = (s: unknown) => !s || (typeof s === 'object' && Object.keys(s as object).every(k => k === 'description'))

function matchesType(v: Lit, types: string[]): boolean {
  const t = litType(v)
  return types.includes(t) || (t === 'number' && types.includes('integer'))
}

// A field nothing types, typed by its name (ids, flags, dates, labels): conservative patterns only.
function nameGuess(key: string | undefined): string | null {
  if (!key || key === '[]') return null
  if (/(^ids$|_ids$|[a-z]Ids$)/.test(key)) return 'array:string'
  if (/(^id$|_id$|[a-z]Id$|^uuid$)/.test(key)) return 'string'
  if (/^(is|has|can|should|allow|enable|show|hide|include|skip|notify)(_|[A-Z])|_(enabled|allowed|active|inclusive|preferred|required|visible)$|^(enabled|active|downloadable|shared|archived|published|visible|confirm|force|dry_run|dryRun|preview|new)$/.test(key)) return 'boolean'
  if (/(_at|At|_date|Date|_on)$|^date$/.test(key)) return 'string'
  if (/^(name|title|slug|description|notes?|reason|message|subject|email|phone|website|url|code|sku|comment|text|label|content|html|summary|reference|key|role|unit|dimension|scenario|status|type|kind|mode|channel|locale|lang|language|currency|gstin|pan|ifsc|token|password|query|q|search|sheet|template|color|icon|image|avatar|logo|category|tag)$|(_url|Url|_name|Name|_key|Key|_gstin|_label|Label|_type|Type|_code|Code|_text|Text|_email|Email|_phone|Phone|_note|Note|_title|Title|_status|Status|_image|Image)$/.test(key)) return 'string'
  if (/^(amount|price|qty|quantity|count|factor|priority|limit|offset|page|weight|rate|percentage|percent|discount|position|sort_order|order|rating|score)$|(_amount|Amount|_price|Price|_qty|Qty|_count|Count|_minutes|_days|Days|_hours|_step|_percent|_rate|_weight|_order|_number|Number|_total|Total)$/.test(key)) return 'number'
  if (/(_data|Data|_filter|Filter|_meta|Meta|_config|Config|_settings|Settings|^config$|^settings$|^metadata$|^meta$|^options$|^fields$|^payload$|^filters$)$/.test(key)) return 'object'
  return null
}

function emitInferred(s: Shape, mode: Mode): JsonSchema {
  const out: JsonSchema = {}
  const types = new Set(s.types)
  if (s.props.size) types.add('object')
  if (s.items) types.add('array')
  let guessed = false
  if (!types.size && !s.binary && !s.closed.size && !s.lits.size && !s.format && mode !== 'query') {
    if (s.weak.size) for (const t of s.weak) types.add(t)
    else if (!s.formField) {
      const g = nameGuess(s.key)
      if (g === 'array:string') {
        types.add('array')
        s.item().types.add('string')
        guessed = true
      } else if (g) {
        types.add(g)
        guessed = true
      }
    }
  }
  if (types.has('integer') && types.has('number')) types.delete('integer')
  if (s.binary) {
    types.clear()
    types.add('string')
    out.format = 'binary'
  }
  if (s.formField) {
    types.delete('null')
    if (!types.size) types.add('string')
  }
  if (mode === 'query' && !types.size) types.add(s.presence ? 'boolean' : 'string')
  const list = [...types].sort()
  if (list.length === 1) out.type = list[0]
  else if (list.length > 1) out.type = list
  if (s.format && !out.format) out.format = s.format
  if (s.props.size) {
    const childMode = mode === 'query' ? 'json' : mode
    out.properties = Object.fromEntries([...s.props].map(([k, c]) => [k, emitShape(c, childMode)]))
    const req = [...s.required].filter(k => s.props.has(k) && !s.props.get(k)!.optional)
    if (req.length) out.required = req
  }
  if (s.items) out.items = emitShape(s.items, mode === 'form' ? 'form' : 'json')
  if (guessed) s.notes.add('type assumed from the field name')
  const enumVals = s.closed.size ? [...s.closed] : s.lits.size >= 2 ? [...s.lits] : null
  if (enumVals && (!list.length || enumVals.every(v => matchesType(v, list)))) out.enum = enumVals
  else if (s.lits.size) out.examples = [...s.lits]
  if (s.dflt !== undefined) {
    let v: Lit = s.dflt
    if ((out.type === 'number' || out.type === 'integer') && typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) v = Number(v)
    if (!list.length || matchesType(v, list)) out.default = v
  }
  const notes = [...s.notes]
  if (s.presence && !s.types.size) notes.push('presence flag')
  if (notes.length) out.description = notes.join('; ')
  if (s.freeform && !s.props.size && !out.type) {
    out.type = 'object'
    out.additionalProperties = true
    out.description = [out.description, 'free-form JSON, stored as sent'].filter(Boolean).join('; ')
  }
  if (!out.type && !out.enum && !out.format && mode !== 'query') out.description = [out.description, 'any JSON value (type not inferred)'].filter(Boolean).join('; ')
  return out
}

function overlay(declared: JsonSchema, inferred: JsonSchema): JsonSchema {
  const d = structuredClone(declared)
  const inferredProps = inferred.properties as Record<string, JsonSchema> | undefined
  const objType = d.type === 'object' || (Array.isArray(d.type) && d.type.includes('object'))
  if ((objType || d.properties) && inferredProps) {
    d.type = 'object'
    const dp = ((d.properties as Record<string, JsonSchema> | undefined) ?? {}) as Record<string, JsonSchema>
    for (const [k, v] of Object.entries(inferredProps)) if (!(k in dp) || isEmptySchema(dp[k])) dp[k] = v
    d.properties = dp
    const req = new Set([...((d.required as string[]) ?? []), ...((inferred.required as string[]) ?? [])].filter(k => k in dp))
    if (req.size) d.required = [...req]
    if (d.additionalProperties !== undefined && Object.keys(dp).length) delete d.additionalProperties
    return d
  }
  if (!d.type && !d.enum && !d.anyOf && !d.const && !d.properties && !d.allOf) return { ...inferred, ...d, description: d.description ?? inferred.description }
  return d
}

/** A query value is a string on the wire: no null, and a number when the handler converts it. */
function queryClean(q: JsonSchema): JsonSchema {
  const out = { ...q }
  let t = Array.isArray(out.type) ? (out.type as string[]) : out.type ? [out.type as string] : []
  t = t.filter(x => x !== 'null')
  if (t.some(x => x === 'number' || x === 'integer')) t = t.filter(x => x !== 'string')
  if (t.includes('integer') && t.includes('number')) t = t.filter(x => x !== 'integer')
  if (!t.length && !out.enum && !out.anyOf) t = ['string']
  if (t.length) out.type = t.length === 1 ? t[0] : t
  else delete out.type
  if ((out.type === 'number' || out.type === 'integer') && typeof out.default === 'string' && out.default.trim() && !Number.isNaN(Number(out.default))) out.default = Number(out.default)
  if (Array.isArray(out.anyOf)) {
    const opts = (out.anyOf as JsonSchema[]).filter(o => o.type !== 'null')
    if (opts.length === 1) {
      delete out.anyOf
      Object.assign(out, opts[0])
    } else out.anyOf = opts
  }
  return out
}

export function emitShape(s: Shape, mode: Mode): JsonSchema {
  if (mode === 'query') return queryClean(emitBase(s, mode))
  return emitBase(s, mode)
}

function emitBase(s: Shape, mode: Mode): JsonSchema {
  if (s.zod && s.declared) return s.declared
  const inferred = emitInferred(s, mode)
  if (!s.declared) return inferred
  const merged = overlay(s.declared, inferred)
  if (mode === 'form' && Array.isArray(merged.type)) {
    const t = (merged.type as string[]).filter(x => x !== 'null')
    merged.type = t.length === 1 ? t[0] : t
  }
  return merged
}

/** Whether the inference found anything worth publishing as a body. */
export function hasContent(s: Shape): boolean {
  if (s.declared && (s.zod || Object.keys((s.declared.properties as object) ?? {}).length || s.declared.anyOf || s.declared.type === 'array')) return true
  return s.props.size > 0 || !!s.items || s.freeform
}
