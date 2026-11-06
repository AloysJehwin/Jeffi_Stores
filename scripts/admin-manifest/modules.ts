// Per-file parsing and name resolution for the manifest generator (no ts.Program: fast and good enough).
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const ROOT = path.resolve(__dirname, '../..')
export const SP_NAMES = new Set(['sp', 'searchParams', 'qs'])

const ALIASES: [string, string][] = [
  ['@/', 'packages/store-core/src/'],
  ['@controller/', 'controller-service/src/'],
  ['@admin/', 'admin-service/src/'],
  ['@storefront/', 'storefront-service/src/'],
  ['@business/', 'business-service/src/'],
]

export interface ImportRef {
  spec: string
  name: string // 'default', '*', or the exported name
}

export interface Mod {
  file: string
  sf: ts.SourceFile
  imports: Map<string, ImportRef>
  locals: Map<string, ts.Node>
  /** Interfaces, type aliases, enums and classes (their names may repeat a value's). */
  types: Map<string, ts.Node>
  exportAlias: Map<string, string>
  reexports: Map<string, ImportRef>
  starExports: string[]
  spNames: Set<string>
}

const modCache = new Map<string, Mod | null>()

export function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string | null = null
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''))
  else {
    for (const [a, to] of ALIASES) if (spec.startsWith(a)) base = path.join(ROOT, to, spec.slice(a.length))
    const pkg = /^@jeffi\/([^/]+)(\/.*)?$/.exec(spec)
    if (!base && pkg) base = path.join(ROOT, 'packages', pkg[1], pkg[2] ? pkg[2].slice(1) : 'src/index')
  }
  if (!base) return null
  for (const c of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && /\.tsx?$/.test(c)) return c
  }
  return null
}

export function loadMod(file: string): Mod | null {
  if (modCache.has(file)) return modCache.get(file)!
  let mod: Mod | null = null
  try {
    const text = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    mod = { file, sf, imports: new Map(), locals: new Map(), types: new Map(), exportAlias: new Map(), reexports: new Map(), starExports: [], spNames: new Set(SP_NAMES) }
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const spec = st.moduleSpecifier.text
        const cl = st.importClause
        if (!cl) continue
        if (cl.name) mod.imports.set(cl.name.text, { spec, name: 'default' })
        const nb = cl.namedBindings
        if (nb && ts.isNamespaceImport(nb)) mod.imports.set(nb.name.text, { spec, name: '*' })
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) mod.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text })
      } else if (ts.isFunctionDeclaration(st) && st.name) {
        mod.locals.set(st.name.text, st)
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) mod.locals.set(d.name.text, d)
      } else if ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) {
        mod.types.set(st.name.text, st)
      } else if (ts.isClassDeclaration(st) && st.name) {
        mod.types.set(st.name.text, st)
        mod.locals.set(st.name.text, st)
      } else if (ts.isExportDeclaration(st)) {
        const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null
        if (!st.exportClause && from) mod.starExports.push(from)
        else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            const local = (el.propertyName ?? el.name).text
            if (from) mod.reexports.set(el.name.text, { spec: from, name: local })
            else mod.exportAlias.set(el.name.text, local)
          }
        }
      }
    }
    const findSp = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const t = n.initializer.getText(sf)
        if (/searchParams|URLSearchParams/.test(t)) {
          if (ts.isIdentifier(n.name)) mod!.spNames.add(n.name.text)
          else if (ts.isObjectBindingPattern(n.name)) for (const el of n.name.elements) if (ts.isIdentifier(el.name)) mod!.spNames.add(el.name.text)
        }
      }
      ts.forEachChild(n, findSp)
    }
    findSp(sf)
  } catch {
    mod = null
  }
  modCache.set(file, mod)
  return mod
}

/** The declaration an exported name points at, following aliases and re-exports. */
export function findExport(mod: Mod, name: string, kind: 'value' | 'type' = 'value', seen = new Set<string>()): { mod: Mod; node: ts.Node } | null {
  const key = `${mod.file}#${name}#${kind}`
  if (seen.has(key)) return null
  seen.add(key)
  const local = mod.exportAlias.get(name) ?? name
  const node = (kind === 'type' ? mod.types : mod.locals).get(local)
  if (node) return { mod, node }
  const imp = mod.imports.get(local)
  if (imp && imp.name !== '*') {
    const f = resolveSpec(imp.spec, mod.file)
    const m = f && loadMod(f)
    if (m) return findExport(m, imp.name, kind, seen)
  }
  const re = mod.reexports.get(name)
  if (re) {
    const f = resolveSpec(re.spec, mod.file)
    const m = f && loadMod(f)
    if (m) return findExport(m, re.name, kind, seen)
  }
  for (const spec of mod.starExports) {
    const f = resolveSpec(spec, mod.file)
    const m = f && loadMod(f)
    const hit = m && findExport(m, name, kind, seen)
    if (hit) return hit
  }
  return null
}

/** A name used in `mod` to its declaration, local or imported. */
export function resolveName(name: string, mod: Mod, kind: 'value' | 'type' = 'value'): { mod: Mod; node: ts.Node } | null {
  const own = (kind === 'type' ? mod.types : mod.locals).get(name)
  if (own) return { mod, node: own }
  const imp = mod.imports.get(name)
  if (!imp || imp.name === '*') return null
  const f = resolveSpec(imp.spec, mod.file)
  const m = f && loadMod(f)
  return m ? findExport(m, imp.name, kind) : null
}

/** `ns.name` where ns is a namespace import. */
export function resolveQualified(ns: string, name: string, mod: Mod, kind: 'value' | 'type' = 'value'): { mod: Mod; node: ts.Node } | null {
  const imp = mod.imports.get(ns)
  if (imp?.name !== '*') return null
  const f = resolveSpec(imp.spec, mod.file)
  const m = f && loadMod(f)
  return m ? findExport(m, name, kind) : null
}

/** A name in `mod` to the expression it is bound to (same file or imported const). */
export function resolveValue(name: string, mod: Mod): { node: ts.Expression; mod: Mod } | null {
  const hit = resolveName(name, mod)
  if (!hit || !ts.isVariableDeclaration(hit.node) || !hit.node.initializer) return null
  return { node: hit.node.initializer, mod: hit.mod }
}

export function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression
  return e
}

export function literalValue(e: ts.Expression, mod: Mod, depth = 0): unknown {
  if (depth > 8) return undefined
  e = unwrap(e)
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isNumericLiteral(e)) return Number(e.text)
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false
  if (e.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text)
  if (ts.isArrayLiteralExpression(e)) {
    const vals = e.elements.map(x => literalValue(x, mod, depth + 1))
    return vals.some(v => v === undefined) ? undefined : vals
  }
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return undefined
    const r = resolveValue(e.text, mod)
    return r ? literalValue(r.node, r.mod, depth + 1) : undefined
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
    const r = resolveValue(e.expression.text, mod)
    const o = r && unwrap(r.node)
    if (o && ts.isObjectLiteralExpression(o)) {
      for (const p of o.properties) if (ts.isPropertyAssignment(p) && propKey(p.name) === e.name.text) return literalValue(p.initializer, r.mod, depth + 1)
    }
  }
  return undefined
}

/** String values of a const array (`['a','b'] as const`), a `new Set([...])`, or an object literal's keys. */
export function literalSet(e: ts.Expression, mod: Mod, keysOfObject = false, depth = 0): (string | number)[] | null {
  if (depth > 6) return null
  e = unwrap(e)
  if (ts.isIdentifier(e)) {
    const r = resolveValue(e.text, mod)
    return r ? literalSet(r.node, r.mod, keysOfObject, depth + 1) : null
  }
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'Set' && e.arguments?.[0]) return literalSet(e.arguments[0], mod, false, depth + 1)
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'keys' && e.expression.expression.getText(mod.sf) === 'Object' && e.arguments[0]) return literalSet(e.arguments[0], mod, true, depth + 1)
  if (keysOfObject && ts.isObjectLiteralExpression(e)) {
    const keys = e.properties.map(p => (p.name ? propKey(p.name) : null))
    return keys.every((k): k is string => !!k) ? keys : null
  }
  const v = literalValue(e, mod, depth + 1)
  return Array.isArray(v) && v.length && v.every(x => typeof x === 'string' || typeof x === 'number') ? (v as (string | number)[]) : null
}

export function propKey(n: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isPrivateIdentifier(n)) return n.text
  if (ts.isNoSubstitutionTemplateLiteral(n as ts.Node as ts.Expression)) return (n as unknown as ts.NoSubstitutionTemplateLiteral).text
  return null
}
