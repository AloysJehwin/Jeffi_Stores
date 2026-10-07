// Legacy entry point; the variable registry and renderer live in src/lib/templates/.
import {
  BUILTIN_TEMPLATE_VARIABLES,
  renderTemplate,
  sampleVariableMap,
  type TemplateVariableDef,
} from '@/lib/templates/variables-shared'

export interface TemplateVarContext {
  recipient: {
    email: string
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
  }
  store?: {
    name?: string
    email?: string
    phone?: string
    web?: string
  }
}

export type TemplateVar = TemplateVariableDef

export const TEMPLATE_VARS: TemplateVar[] = BUILTIN_TEMPLATE_VARIABLES

// Sync and DB-free, so `store` must be passed in; prefer resolveTemplateVariables() which loads it.
export function buildVarMap(ctx: TemplateVarContext): Record<string, string> {
  const r = ctx.recipient
  const s = ctx.store || {}
  const first = (r.first_name || '').trim()
  const last = (r.last_name || '').trim()
  return {
    customer_first_name: first || 'there',
    customer_last_name: last,
    customer_name: [first, last].filter(Boolean).join(' ') || 'there',
    customer_email: r.email,
    store_name: s.name || '',
    store_email: s.email || '',
    store_phone: s.phone || '',
    store_web: s.web || '',
    current_year: String(new Date().getFullYear()),
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  }
}

export function substituteVars(input: string, vars: Record<string, string>): string {
  return renderTemplate(input, vars)
}

export function previewVarMap(): Record<string, string> {
  return sampleVariableMap()
}
