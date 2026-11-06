// TypeScript type annotations → JSON Schema, syntactically (interfaces, aliases, utility types, z.infer).
import ts from 'typescript'
import type { JsonSchema } from '../../packages/cli/src/manifest-types'
import { type Mod, literalSet, propKey, resolveName, resolveQualified } from './modules'
import { conv } from './zod'

interface T {
  s: JsonSchema
  optional: boolean
}

const MAX_DEPTH = 10

function jsdoc(n: ts.Node, mod: Mod): string | null {
  const text = mod.sf.text
  const ranges = ts.getLeadingCommentRanges(text, n.getFullStart()) ?? []
  const docs = ranges.map(r => text.slice(r.pos, r.end)).filter(c => c.startsWith('/**') || c.startsWith('//'))
  if (!docs.length) return null
  const s = docs
    .join(' ')
    .replace(/^\/\*\*?|\*\/$/gm, '')
    .split('\n')
    .map(l => l.replace(/^\s*(\/\/+|\*)\s?/, '').trim())
    .join(' ')
    .replace(/\*\/|\/\*\*?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s && s.length <= 200 ? s : s ? s.slice(0, 197) + '…' : null
}

function members(list: ts.NodeArray<ts.TypeElement>, mod: Mod, depth: number, seen: Set<string>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  let additional: JsonSchema | undefined
  for (const m of list) {
    if (ts.isPropertySignature(m) && m.name) {
      const key = propKey(m.name)
      if (!key) continue
      const t = m.type ? conv1(m.type, mod, depth + 1, seen) : null
      const s: JsonSchema = t ? { ...t.s } : {}
      const doc = jsdoc(m, mod)
      if (doc && !s.description) s.description = doc
      if (!t && !s.description) s.description = 'any JSON value'
      properties[key] = s
      if (!m.questionToken && !t?.optional) required.push(key)
    } else if (ts.isIndexSignatureDeclaration(m)) {
      additional = m.type ? conv1(m.type, mod, depth + 1, seen)?.s ?? {} : {}
    }
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), ...(additional ? { additionalProperties: additional } : {}) }
}

/** Object schemas merged (intersection / extends); anything else ends up in allOf. */
export function mergeObjects(list: JsonSchema[]): JsonSchema {
  const objs = list.filter(s => s.type === 'object' || s.properties)
  if (objs.length !== list.length) return { allOf: list }
  const properties: Record<string, JsonSchema> = {}
  const required = new Set<string>()
  let additional: unknown
  for (const o of objs) {
    Object.assign(properties, o.properties ?? {})
    for (const r of (o.required as string[] | undefined) ?? []) required.add(r)
    if (o.additionalProperties !== undefined) additional = o.additionalProperties
  }
  return { type: 'object', properties, ...(required.size ? { required: [...required] } : {}), ...(additional !== undefined && !Object.keys(properties).length ? { additionalProperties: additional } : {}) }
}

function literalOf(t: ts.LiteralTypeNode): unknown {
  const l = t.literal
  if (ts.isStringLiteral(l) || ts.isNoSubstitutionTemplateLiteral(l)) return l.text
  if (ts.isNumericLiteral(l)) return Number(l.text)
  if (ts.isPrefixUnaryExpression(l) && ts.isNumericLiteral(l.operand)) return -Number(l.operand.text)
  if (l.kind === ts.SyntaxKind.TrueKeyword) return true
  if (l.kind === ts.SyntaxKind.FalseKeyword) return false
  if (l.kind === ts.SyntaxKind.NullKeyword) return null
  return undefined
}

function declSchema(node: ts.Node, mod: Mod, depth: number, seen: Set<string>): T | null {
  if (ts.isInterfaceDeclaration(node)) {
    const own = members(node.members, mod, depth, seen)
    const bases: JsonSchema[] = []
    for (const h of node.heritageClauses ?? []) for (const e of h.types) {
      const b = refSchema(e.expression, e.typeArguments, mod, depth + 1, seen)
      if (b) bases.push(b.s)
    }
    return { s: bases.length ? mergeObjects([...bases, own]) : own, optional: false }
  }
  if (ts.isTypeAliasDeclaration(node)) return conv1(node.type, mod, depth + 1, seen)
  if (ts.isEnumDeclaration(node)) {
    const vals = node.members.map((m, i) => (m.initializer && (ts.isStringLiteral(m.initializer) || ts.isNumericLiteral(m.initializer)) ? (ts.isStringLiteral(m.initializer) ? m.initializer.text : Number(m.initializer.text)) : i))
    return { s: { type: vals.every(v => typeof v === 'string') ? 'string' : 'number', enum: vals }, optional: false }
  }
  return null
}

function refSchema(name: ts.Expression | ts.EntityName, args: ts.NodeArray<ts.TypeNode> | undefined, mod: Mod, depth: number, seen: Set<string>): T | null {
  if (depth > MAX_DEPTH) return null
  const ok = (s: JsonSchema): T => ({ s, optional: false })
  const a = (i: number) => (args?.[i] ? conv1(args[i], mod, depth + 1, seen) : null)
  let text: string
  let hit: { mod: Mod; node: ts.Node } | null = null
  if (ts.isIdentifier(name)) {
    text = name.text
  } else if (ts.isQualifiedName(name) || ts.isPropertyAccessExpression(name)) {
    const left = ts.isQualifiedName(name) ? name.left : name.expression
    const right = ts.isQualifiedName(name) ? name.right : name.name
    text = `${left.getText(mod.sf)}.${right.text}`
    if (/^z\.(infer|input|output)$/.test(text) && args?.[0] && ts.isTypeQueryNode(args[0])) {
      const q = args[0].exprName
      const expr = ts.isIdentifier(q) ? q : null
      const c = expr ? conv(expr, mod) : null
      return c ? ok(c.s) : null
    }
    if (ts.isIdentifier(left)) hit = resolveQualified(left.text, right.text, mod, 'type')
  } else return null
  switch (text) {
    case 'Array': case 'ReadonlyArray': case 'Set': return ok({ type: 'array', items: a(0)?.s ?? {} })
    case 'Record': case 'Map': {
      const keys = args?.[0] && ts.isUnionTypeNode(args[0]) && args[0].types.every(t => ts.isLiteralTypeNode(t)) ? args[0].types.map(t => literalOf(t as ts.LiteralTypeNode)) : null
      const v = a(1)?.s ?? {}
      if (keys && keys.every(k => typeof k === 'string')) return ok({ type: 'object', properties: Object.fromEntries((keys as string[]).map(k => [k, v])) })
      return ok({ type: 'object', additionalProperties: v })
    }
    case 'Partial': { const t = a(0); if (!t) return null; const s = { ...t.s }; delete s.required; return ok(s) }
    case 'Required': { const t = a(0); if (!t) return null; return ok(t.s.properties ? { ...t.s, required: Object.keys(t.s.properties as object) } : t.s) }
    case 'Readonly': case 'NonNullable': case 'Awaited': return a(0)
    case 'Pick': case 'Omit': {
      const t = a(0)
      if (!t?.s.properties) return t
      const keyNode = args?.[1]
      const keys = new Set<string>()
      const addKey = (n: ts.TypeNode) => { if (ts.isLiteralTypeNode(n)) { const v = literalOf(n); if (typeof v === 'string') keys.add(v) } }
      if (keyNode && ts.isUnionTypeNode(keyNode)) keyNode.types.forEach(addKey)
      else if (keyNode) addKey(keyNode)
      const props = Object.fromEntries(Object.entries(t.s.properties as Record<string, JsonSchema>).filter(([k]) => keys.has(k) === (text === 'Pick')))
      const req = ((t.s.required as string[]) ?? []).filter(k => k in props)
      return ok({ ...t.s, properties: props, ...(req.length ? { required: req } : { required: undefined }) })
    }
    case 'Date': return ok({ type: 'string', format: 'date-time' })
    case 'File': case 'Blob': return ok({ type: 'string', format: 'binary' })
    case 'Buffer': case 'Uint8Array': case 'ArrayBuffer': return ok({ type: 'string', format: 'binary' })
    case 'JsonValue': case 'Json': case 'unknown': return null
  }
  if (!hit && ts.isIdentifier(name)) hit = resolveName(name.text, mod, 'type')
  if (!hit) return null
  const key = `${hit.mod.file}#${text}`
  if (seen.has(key)) return ok({ type: 'object', description: `${text} (recursive)` })
  const next = new Set(seen)
  next.add(key)
  return declSchema(hit.node, hit.mod, depth + 1, next)
}

function conv1(t: ts.TypeNode, mod: Mod, depth: number, seen: Set<string>): T | null {
  if (depth > MAX_DEPTH) return null
  const ok = (s: JsonSchema, optional = false): T => ({ s, optional })
  switch (t.kind) {
    case ts.SyntaxKind.StringKeyword: return ok({ type: 'string' })
    case ts.SyntaxKind.NumberKeyword: return ok({ type: 'number' })
    case ts.SyntaxKind.BigIntKeyword: return ok({ type: 'integer' })
    case ts.SyntaxKind.BooleanKeyword: return ok({ type: 'boolean' })
    case ts.SyntaxKind.NullKeyword: return ok({ type: 'null' })
    case ts.SyntaxKind.ObjectKeyword: return ok({ type: 'object' })
    case ts.SyntaxKind.UndefinedKeyword: case ts.SyntaxKind.VoidKeyword: return ok({}, true)
    case ts.SyntaxKind.AnyKeyword: case ts.SyntaxKind.UnknownKeyword: case ts.SyntaxKind.NeverKeyword: return null
  }
  if (ts.isParenthesizedTypeNode(t)) return conv1(t.type, mod, depth, seen)
  if (ts.isTypeOperatorNode(t)) {
    if (t.operator === ts.SyntaxKind.KeyOfKeyword && ts.isTypeQueryNode(t.type) && ts.isIdentifier(t.type.exprName)) {
      const keys = literalSet(t.type.exprName, mod, true)
      return keys ? ok({ type: 'string', enum: keys }) : ok({ type: 'string' })
    }
    return conv1(t.type, mod, depth, seen)
  }
  if (ts.isLiteralTypeNode(t)) {
    const v = literalOf(t)
    if (v === undefined) return null
    if (v === null) return ok({ type: 'null' })
    return ok({ type: typeof v === 'number' ? 'number' : typeof v, const: v })
  }
  if (ts.isTemplateLiteralTypeNode(t)) return ok({ type: 'string' })
  if (ts.isArrayTypeNode(t)) return ok({ type: 'array', items: conv1(t.elementType, mod, depth + 1, seen)?.s ?? {} })
  if (ts.isTupleTypeNode(t)) return ok({ type: 'array', prefixItems: t.elements.map(e => conv1(ts.isNamedTupleMember(e) ? e.type : e, mod, depth + 1, seen)?.s ?? {}) })
  if (ts.isTypeLiteralNode(t)) return ok(members(t.members, mod, depth, seen))
  if (ts.isIntersectionTypeNode(t)) {
    const parts = t.types.map(x => conv1(x, mod, depth + 1, seen)).filter((x): x is T => !!x)
    return parts.length ? ok(parts.length === 1 ? parts[0].s : mergeObjects(parts.map(p => p.s))) : null
  }
  if (ts.isUnionTypeNode(t)) {
    let optional = false
    let nullable = false
    const lits: unknown[] = []
    const rest: ts.TypeNode[] = []
    for (const x of t.types) {
      if (x.kind === ts.SyntaxKind.UndefinedKeyword) optional = true
      else if (x.kind === ts.SyntaxKind.NullKeyword || (ts.isLiteralTypeNode(x) && x.literal.kind === ts.SyntaxKind.NullKeyword)) nullable = true
      else if (ts.isLiteralTypeNode(x) && literalOf(x) !== undefined) lits.push(literalOf(x))
      else rest.push(x)
    }
    const opts: JsonSchema[] = []
    if (lits.length) {
      const allStr = lits.every(v => typeof v === 'string')
      const allNum = lits.every(v => typeof v === 'number')
      const allBool = lits.every(v => typeof v === 'boolean')
      if (allBool && lits.length === 2) opts.push({ type: 'boolean' })
      else opts.push({ ...(allStr ? { type: 'string' } : allNum ? { type: 'number' } : {}), enum: lits })
    }
    for (const x of rest) {
      const c = conv1(x, mod, depth + 1, seen)
      if (!c) return nullable || optional ? { s: {}, optional } : null
      opts.push(c.s)
    }
    let s: JsonSchema = opts.length === 1 ? opts[0] : opts.length ? { anyOf: opts } : {}
    if (nullable) s = opts.length === 1 && typeof s.type === 'string' && !s.enum ? { ...s, type: [s.type, 'null'] } : { anyOf: [...(s.anyOf as JsonSchema[] | undefined) ?? (opts.length ? [s] : []), { type: 'null' }] }
    return { s, optional }
  }
  if (ts.isIndexedAccessTypeNode(t)) {
    // (typeof STATUSES)[number]
    const obj = ts.isParenthesizedTypeNode(t.objectType) ? t.objectType.type : t.objectType
    if (ts.isTypeQueryNode(obj) && ts.isIdentifier(obj.exprName) && t.indexType.kind === ts.SyntaxKind.NumberKeyword) {
      const vals = literalSet(obj.exprName, mod)
      if (vals) return ok({ type: vals.every(v => typeof v === 'string') ? 'string' : 'number', enum: vals })
    }
    if (ts.isTypeQueryNode(obj) && ts.isIdentifier(obj.exprName) && ts.isTypeOperatorNode(t.indexType)) {
      const vals = literalSet(obj.exprName, mod, true)
      if (vals) return ok({ type: 'string', enum: vals })
    }
    const base = conv1(obj, mod, depth + 1, seen)
    if (base?.s.properties && ts.isLiteralTypeNode(t.indexType)) {
      const k = literalOf(t.indexType)
      const p = typeof k === 'string' ? (base.s.properties as Record<string, JsonSchema>)[k] : undefined
      return p ? ok(p) : null
    }
    return null
  }
  if (ts.isTypeReferenceNode(t)) return refSchema(t.typeName, t.typeArguments, mod, depth, seen)
  if (ts.isExpressionWithTypeArguments(t)) return refSchema(t.expression, t.typeArguments, mod, depth, seen)
  return null
}

/** JSON Schema for a type annotation, null when it says nothing (any, unknown, unresolvable). */
export function typeSchema(t: ts.TypeNode, mod: Mod): { s: JsonSchema; optional: boolean } | null {
  const r = conv1(t, mod, 0, new Set())
  if (!r) return null
  const s = r.s
  // `Record<string, any>` (or `| null`) and friends say nothing about the keys.
  const objType = s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object') && s.type.every(t => t === 'object' || t === 'null'))
  if (objType && !s.properties && (s.additionalProperties === undefined || (typeof s.additionalProperties === 'object' && !Object.keys(s.additionalProperties as object).length))) return { s: { type: 'object' }, optional: r.optional }
  const anyOf = s.anyOf as JsonSchema[] | undefined
  if (anyOf?.length === 2 && anyOf.some(x => x.type === 'null')) {
    const other = anyOf.find(x => x.type !== 'null')!
    if (other.type === 'object' && !other.properties) return { s: { type: 'object' }, optional: r.optional }
  }
  return r
}

/** JSON Schema of a named interface / type alias / enum declaration. */
export function declarationSchema(node: ts.Node, mod: Mod): JsonSchema | null {
  return declSchema(node, mod, 0, new Set())?.s ?? null
}
