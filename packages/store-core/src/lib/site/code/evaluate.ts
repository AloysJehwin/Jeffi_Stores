import type { CodeValue } from './ast'
import { FORBIDDEN_KEYS } from './allow'

// Values in a code section's AST, evaluated against the render-function bindings in scope. Reads only own data
// properties of plain objects and arrays; never calls anything.

export type Vars = ReadonlyMap<string, unknown>

function step(cur: unknown, key: string): unknown {
  if (cur == null || FORBIDDEN_KEYS.has(key)) return undefined
  if (Array.isArray(cur)) return key === 'length' ? cur.length : /^\d+$/.test(key) ? cur[Number(key)] : undefined
  if (typeof cur === 'string') return key === 'length' ? cur.length : undefined
  if (typeof cur === 'object') {
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined
    const desc = Object.getOwnPropertyDescriptor(cur, key)
    return desc && 'value' in desc ? desc.value : undefined
  }
  return undefined
}

const plain = (v: unknown) => (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint' ? undefined : v)

/** A price-like value ({ value, formatted }) reads as its number in comparisons and its text when shown. */
const asNumber = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number') return (v as { value: number }).value
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  return !!v
}

export function toText(v: unknown): string {
  if (v == null || typeof v === 'boolean') return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'object' && !Array.isArray(v)) {
    const f = step(v, 'formatted')
    if (typeof f === 'string') return f
  }
  return ''
}

export function evalValue(v: unknown, vars: Vars, depth = 0): unknown {
  if (!v || typeof v !== 'object' || depth > 50) return undefined
  const c = v as CodeValue
  switch (c.k) {
    case 'lit':
      return plain(c.v)
    case 'path': {
      if (typeof c.root !== 'string' || !vars.has(c.root) || !Array.isArray(c.path)) return undefined
      let cur = vars.get(c.root)
      for (const k of c.path) cur = step(cur, String(k))
      return plain(cur)
    }
    case 'tpl':
      return Array.isArray(c.parts) ? c.parts.map(p => (typeof p === 'string' ? p : toText(evalValue(p, vars, depth + 1)))).join('') : ''
    case 'not':
      return !truthy(evalValue(c.v, vars, depth + 1))
    case 'bool':
      return truthy(evalValue(c.v, vars, depth + 1))
    case 'eq': {
      const a = evalValue(c.a, vars, depth + 1)
      const b = evalValue(c.b, vars, depth + 1)
      return a === b || (a == null && b == null) || (typeof a === 'object' && a !== null && typeof b === 'number' && asNumber(a) === b)
    }
    case 'cmp': {
      const a = asNumber(evalValue(c.a, vars, depth + 1))
      const b = asNumber(evalValue(c.b, vars, depth + 1))
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      return c.op === '<' ? a < b : c.op === '<=' ? a <= b : c.op === '>' ? a > b : c.op === '>=' ? a >= b : false
    }
    case 'cond':
      return truthy(evalValue(c.test, vars, depth + 1)) ? evalValue(c.then, vars, depth + 1) : evalValue(c.else, vars, depth + 1)
    case 'obj': {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(c.v ?? {})) if (!FORBIDDEN_KEYS.has(k)) out[k] = evalValue(x, vars, depth + 1)
      return out
    }
    case 'arr':
      return Array.isArray(c.v) ? c.v.map(x => evalValue(x, vars, depth + 1)) : []
    default:
      return undefined
  }
}
