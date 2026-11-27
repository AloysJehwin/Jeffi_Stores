import { normalizePhone } from '../../phone'
import { LANGUAGES } from '../../types'
import type { InputSpec } from '../types'

// Validates and coerces the raw values of a job against the agent's declared inputs (docs/plans/OUTREACH_AGENTS.md §2).
// Values arrive as JSON, CSV cells or form fields, so everything is accepted as text and normalised.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TRUE = new Set(['true', 'yes', 'y', '1'])
const FALSE = new Set(['false', 'no', 'n', '0'])

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())

function coerceOne(name: string, spec: InputSpec, raw: unknown): { value: unknown } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : String(raw)
  const bad = (what: string) => ({ error: `${name}: ${what}` })
  switch (spec.type) {
    case 'phone': {
      const p = normalizePhone(text)
      return p ? { value: p } : bad('not a valid Indian mobile number')
    }
    case 'email':
      return EMAIL.test(text) ? { value: text.toLowerCase() } : bad('not a valid email address')
    case 'number': {
      const n = Number(text.replace(/,/g, ''))
      return Number.isFinite(n) ? { value: n } : bad('not a number')
    }
    case 'money': {
      const n = Number(text.replace(/[₹,\s]|rs\.?/gi, ''))
      return Number.isFinite(n) && n >= 0 ? { value: n } : bad('not an amount')
    }
    case 'date':
    case 'datetime': {
      const d = raw instanceof Date ? raw : new Date(text)
      if (Number.isNaN(d.getTime())) return bad(`not a ${spec.type}`)
      return { value: spec.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString() }
    }
    case 'url':
      try {
        const u = new URL(text)
        return u.protocol === 'http:' || u.protocol === 'https:' ? { value: u.toString() } : bad('not an http(s) link')
      } catch {
        return bad('not a link')
      }
    case 'enum': {
      const hit = (spec.enum ?? []).find(e => e.toLowerCase() === text.toLowerCase())
      return hit ? { value: hit } : bad(`must be one of ${(spec.enum ?? []).join(', ')}`)
    }
    case 'boolean': {
      const t = text.toLowerCase()
      return TRUE.has(t) ? { value: true } : FALSE.has(t) ? { value: false } : bad('must be yes or no')
    }
    case 'language': {
      const l = text.toLowerCase().split('-')[0]
      return (LANGUAGES as readonly string[]).includes(l) ? { value: l } : bad(`must be one of ${LANGUAGES.join(', ')}`)
    }
    default:
      // text and the reference types (an order number, a checkout key, a product or user id)
      return text.length <= 500 ? { value: text } : bad('too long')
  }
}

/** The declared inputs only (unknown keys are dropped), each coerced; errors name the input. */
export function coerceInputs(spec: Record<string, InputSpec>, raw: Record<string, unknown>): { inputs: Record<string, unknown>; errors: string[] } {
  const inputs: Record<string, unknown> = {}
  const errors: string[] = []
  for (const [name, s] of Object.entries(spec)) {
    const v = raw?.[name]
    if (blank(v)) {
      if (s.required) errors.push(`${name} is required`)
      continue
    }
    const r = coerceOne(name, s, v)
    if ('error' in r) errors.push(r.error)
    else inputs[name] = r.value
  }
  return { inputs, errors }
}
