// Zod → JSON Schema, statically and best effort.
import ts from 'typescript'
import type { JsonSchema } from '../../packages/cli/src/manifest-types'
import { type Mod, findExport, literalValue, loadMod, resolveSpec, resolveValue, unwrap } from './modules'

export interface Conv {
  s: JsonSchema
  optional: boolean
}

const STRING_FORMATS: Record<string, string> = { email: 'email', url: 'uri', uuid: 'uuid', guid: 'uuid', cuid: 'cuid', ipv4: 'ipv4', ipv6: 'ipv6', datetime: 'date-time', date: 'date', time: 'time', e164: 'e164' }

function objectSchema(lit: ts.Expression, mod: Mod, depth: number): JsonSchema | null {
  lit = unwrap(lit)
  if (ts.isIdentifier(lit)) {
    const r = resolveValue(lit.text, mod)
    return r ? objectSchema(r.node, r.mod, depth + 1) : null
  }
  if (!ts.isObjectLiteralExpression(lit)) return null
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const p of lit.properties) {
    if (ts.isSpreadAssignment(p)) {
      const ex = unwrap(p.expression)
      const base = ts.isPropertyAccessExpression(ex) && ex.name.text === 'shape' ? conv(ex.expression, mod, depth + 1) : null
      if (base && base.s.properties) {
        Object.assign(properties, base.s.properties)
        for (const k of (base.s.required as string[] | undefined) ?? []) if (!required.includes(k)) required.push(k)
      }
      continue
    }
    const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name)) ? p.name.text : null
    if (!key) continue
    const init = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : null
    if (!init) continue
    const c = conv(init, mod, depth + 1)
    properties[key] = c ? c.s : {}
    if (!c || !c.optional) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

function factory(name: string, args: ts.NodeArray<ts.Expression>, mod: Mod, depth: number): Conv | null {
  const a0 = args[0]
  const ok = (s: JsonSchema, optional = false): Conv => ({ s, optional })
  switch (name) {
    case 'string': return ok({ type: 'string' })
    case 'number': case 'float32': case 'float64': return ok({ type: 'number' })
    case 'int': case 'int32': case 'uint32': case 'bigint': case 'int64': return ok({ type: 'integer' })
    case 'boolean': case 'stringbool': return ok({ type: 'boolean' })
    case 'date': return ok({ type: 'string', format: 'date-time' })
    case 'any': case 'unknown': case 'custom': case 'instanceof': case 'lazy': case 'json': case 'file': return ok({})
    case 'null': return ok({ type: 'null' })
    case 'undefined': case 'void': return ok({}, true)
    case 'never': return ok({ not: {} })
    case 'object': case 'strictObject': case 'looseObject': {
      const o = a0 ? objectSchema(a0, mod, depth) : { type: 'object', properties: {} }
      return o ? ok(name === 'strictObject' ? { ...o, additionalProperties: false } : o) : null
    }
    case 'array': {
      const inner = a0 ? conv(a0, mod, depth + 1) : null
      return ok({ type: 'array', items: inner ? inner.s : {} })
    }
    case 'enum': {
      const v = a0 ? literalValue(a0, mod) : undefined
      if (Array.isArray(v) && v.every(x => typeof x === 'string')) return ok({ type: 'string', enum: v })
      return ok({ type: 'string' })
    }
    case 'nativeEnum': return ok({})
    case 'literal': {
      const v = a0 ? literalValue(a0, mod) : undefined
      if (v === undefined) return ok({})
      if (Array.isArray(v)) return ok({ enum: v })
      return ok({ const: v, ...(v === null ? {} : { type: typeof v === 'number' ? 'number' : typeof v }) })
    }
    case 'union': case 'discriminatedUnion': case 'xor': {
      const list = unwrap(name === 'discriminatedUnion' ? args[1] : a0)
      if (!list || !ts.isArrayLiteralExpression(list)) return ok({})
      const opts = list.elements.map(x => conv(x, mod, depth + 1))
      return ok({ anyOf: opts.map(o => (o ? o.s : {})) }, opts.some(o => o?.optional))
    }
    case 'intersection': {
      const l = a0 && conv(a0, mod, depth + 1)
      const r = args[1] && conv(args[1], mod, depth + 1)
      return ok({ allOf: [l ? l.s : {}, r ? r.s : {}] })
    }
    case 'record': case 'map': {
      const v = args[args.length - 1]
      const c = v ? conv(v, mod, depth + 1) : null
      return ok({ type: 'object', additionalProperties: c ? c.s : {} })
    }
    case 'tuple': {
      const list = a0 && unwrap(a0)
      if (!list || !ts.isArrayLiteralExpression(list)) return ok({ type: 'array' })
      return ok({ type: 'array', prefixItems: list.elements.map(x => conv(x, mod, depth + 1)?.s ?? {}) })
    }
    case 'optional': { const c = a0 && conv(a0, mod, depth + 1); return c ? { s: c.s, optional: true } : ok({}, true) }
    case 'nullable': { const c = a0 && conv(a0, mod, depth + 1); return ok({ anyOf: [c ? c.s : {}, { type: 'null' }] }, c?.optional) }
    case 'preprocess': { const c = args[1] && conv(args[1], mod, depth + 1); return c ?? ok({}) }
    default:
      if (STRING_FORMATS[name]) return ok({ type: 'string', format: STRING_FORMATS[name] })
      return null
  }
}

function chain(inner: Conv, m: string, args: ts.NodeArray<ts.Expression>, mod: Mod, depth: number): Conv {
  const s: JsonSchema = { ...inner.s }
  const a0 = args[0]
  const v0 = a0 ? literalValue(a0, mod) : undefined
  const num = typeof v0 === 'number' ? v0 : undefined
  const t = s.type
  switch (m) {
    case 'optional': return { s, optional: true }
    case 'nullable': return { s: { anyOf: [s, { type: 'null' }] }, optional: inner.optional }
    case 'nullish': return { s: { anyOf: [s, { type: 'null' }] }, optional: true }
    case 'default': case 'prefault': case 'catch':
      if (v0 !== undefined && typeof v0 !== 'object') s.default = v0
      return { s, optional: true }
    case 'describe': if (typeof v0 === 'string') s.description = v0; return { s, optional: inner.optional }
    case 'array': return { s: { type: 'array', items: s }, optional: false }
    case 'or': { const o = a0 && conv(a0, mod, depth + 1); return { s: { anyOf: [s, o ? o.s : {}] }, optional: inner.optional } }
    case 'and': { const o = a0 && conv(a0, mod, depth + 1); return { s: { allOf: [s, o ? o.s : {}] }, optional: inner.optional } }
    case 'partial': if (s.properties) delete s.required; return { s, optional: inner.optional }
    case 'required': if (s.properties) s.required = Object.keys(s.properties as object); return { s, optional: inner.optional }
    case 'strict': return { s: { ...s, additionalProperties: false }, optional: inner.optional }
    case 'extend': case 'safeExtend': case 'merge': {
      const add = a0 ? (m === 'merge' ? conv(a0, mod, depth + 1)?.s ?? null : objectSchema(a0, mod, depth + 1)) : null
      if (add?.properties) {
        s.properties = { ...(s.properties as object), ...(add.properties as object) }
        const req = new Set([...((s.required as string[]) ?? []), ...((add.required as string[]) ?? [])])
        for (const k of Object.keys(add.properties as object)) if (!((add.required as string[]) ?? []).includes(k)) req.delete(k)
        if (req.size) s.required = [...req]
        else delete s.required
      }
      return { s, optional: inner.optional }
    }
    case 'pick': case 'omit': {
      const lit = a0 && unwrap(a0)
      if (lit && ts.isObjectLiteralExpression(lit) && s.properties) {
        const keys = new Set(lit.properties.map(p => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '')))
        const props = Object.fromEntries(Object.entries(s.properties as Record<string, JsonSchema>).filter(([k]) => keys.has(k) === (m === 'pick')))
        s.properties = props
        const req = ((s.required as string[]) ?? []).filter(k => k in props)
        if (req.length) s.required = req
        else delete s.required
      }
      return { s, optional: inner.optional }
    }
    case 'keyof': return { s: { type: 'string', enum: Object.keys((s.properties as object) ?? {}) }, optional: false }
    case 'int': return { s: { ...s, type: 'integer' }, optional: inner.optional }
    case 'positive': s.exclusiveMinimum = 0; return { s, optional: inner.optional }
    case 'nonnegative': s.minimum = 0; return { s, optional: inner.optional }
    case 'negative': s.exclusiveMaximum = 0; return { s, optional: inner.optional }
    case 'nonempty':
      if (t === 'array') s.minItems = 1
      else s.minLength = 1
      return { s, optional: inner.optional }
    case 'min': case 'gte': case 'max': case 'lte': case 'gt': case 'lt': case 'length': {
      if (num === undefined) return { s, optional: inner.optional }
      const isMin = m === 'min' || m === 'gte' || m === 'gt'
      if (t === 'string') {
        if (m === 'length') { s.minLength = num; s.maxLength = num } else s[isMin ? 'minLength' : 'maxLength'] = num
      } else if (t === 'array') {
        if (m === 'length') { s.minItems = num; s.maxItems = num } else s[isMin ? 'minItems' : 'maxItems'] = num
      } else if (t === 'number' || t === 'integer') {
        if (m === 'gt') s.exclusiveMinimum = num
        else if (m === 'lt') s.exclusiveMaximum = num
        else s[isMin ? 'minimum' : 'maximum'] = num
      }
      return { s, optional: inner.optional }
    }
    case 'regex': {
      const re = a0 && unwrap(a0)
      if (re && ts.isRegularExpressionLiteral(re)) s.pattern = re.text.slice(1, re.text.lastIndexOf('/'))
      return { s, optional: inner.optional }
    }
    default:
      if (STRING_FORMATS[m] && t === 'string') s.format = STRING_FORMATS[m]
      // refine / transform / pipe / trim / brand / meta …: the input shape is unchanged.
      return { s, optional: inner.optional }
  }
}

export function conv(expr: ts.Expression, mod: Mod, depth = 0): Conv | null {
  if (depth > 24) return null
  const e = unwrap(expr)
  if (ts.isIdentifier(e)) {
    const r = resolveValue(e.text, mod)
    return r ? conv(r.node, r.mod, depth + 1) : null
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const imp = mod.imports.get(e.expression.text)
    if (imp?.name === '*') {
      const f = resolveSpec(imp.spec, mod.file)
      const m = f && loadMod(f)
      const hit = m && findExport(m, e.name.text)
      if (hit && ts.isVariableDeclaration(hit.node) && hit.node.initializer) return conv(hit.node.initializer, hit.mod, depth + 1)
    }
    return null
  }
  // A local schema factory: `const days = (max: number) => z.number().int().max(max)`.
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const r = resolveValue(e.expression.text, mod)
    const fn = r && unwrap(r.node)
    if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      const ret = ts.isBlock(fn.body) ? fn.body.statements.find(ts.isReturnStatement)?.expression : fn.body
      return ret ? conv(ret, r.mod, depth + 1) : null
    }
    return null
  }
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return null
  const callee = e.expression
  const obj = unwrap(callee.expression)
  const objText = obj.getText(mod.sf)
  if (objText === 'z' || objText === 'z.coerce' || objText === 'z.iso' || objText === 'z.string.format') return factory(callee.name.text, e.arguments, mod, depth)
  const inner = conv(obj, mod, depth + 1)
  return inner ? chain(inner, callee.name.text, e.arguments, mod, depth) : null
}

/** Does this expression (or what it names) look like a zod schema at all? */
export function looksZod(expr: ts.Expression, mod: Mod, depth = 0): boolean {
  const e = unwrap(expr)
  if (depth > 6) return false
  if (ts.isIdentifier(e)) {
    const r = resolveValue(e.text, mod)
    return !!r && looksZod(r.node, r.mod, depth + 1)
  }
  return /\bz\./.test(e.getText(mod.sf))
}
