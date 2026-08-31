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

// Blank, not the platform's identity: a caller that omits `store` on a tenant would
// otherwise sign the tenant's mail with the platform's name and contact details.
const STORE_DEFAULTS = { name: '', email: '', phone: '', web: '' }

export interface TemplateVar {
  key: string
  label: string
  description: string
  group: 'customer' | 'store' | 'date'
  sample: string
}

export const TEMPLATE_VARS: TemplateVar[] = [
  { key: 'customer_first_name', label: 'First name', description: "Recipient's first name (falls back to 'there')", group: 'customer', sample: 'Aloys' },
  { key: 'customer_last_name', label: 'Last name', description: "Recipient's last name (empty if not on file)", group: 'customer', sample: 'Jehwin' },
  { key: 'customer_name', label: 'Full name', description: "Recipient's full name (first + last)", group: 'customer', sample: 'Aloys Jehwin' },
  { key: 'customer_email', label: 'Email', description: "Recipient's email address", group: 'customer', sample: 'customer@example.com' },
  { key: 'store_name', label: 'Store name', description: 'Configured store / business name', group: 'store', sample: 'Jeffi Stores' },
  { key: 'store_email', label: 'Store email', description: 'Configured store contact email', group: 'store', sample: 'jeffistoress@gmail.com' },
  { key: 'store_phone', label: 'Store phone', description: 'Configured store contact phone', group: 'store', sample: '+91 96853 54099' },
  { key: 'store_web', label: 'Store URL', description: 'Customer-facing site URL', group: 'store', sample: 'jeffistores.in' },
  { key: 'current_year', label: 'Year', description: 'Current 4-digit year', group: 'date', sample: String(new Date().getFullYear()) },
  { key: 'date', label: 'Today', description: 'Today in DD Mon YYYY format', group: 'date', sample: '15 Jun 2026' },
]

export function buildVarMap(ctx: TemplateVarContext): Record<string, string> {
  const r = ctx.recipient
  const s = { ...STORE_DEFAULTS, ...(ctx.store || {}) }
  const first = (r.first_name || '').trim()
  const last = (r.last_name || '').trim()
  const fullName = [first, last].filter(Boolean).join(' ') || first || 'there'
  return {
    customer_first_name: first || 'there',
    customer_last_name: last,
    customer_name: fullName,
    customer_email: r.email,
    store_name: s.name,
    store_email: s.email,
    store_phone: s.phone,
    store_web: s.web,
    current_year: String(new Date().getFullYear()),
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  }
}

export function substituteVars(input: string, vars: Record<string, string>): string {
  if (!input) return input
  return input.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (match, name) => {
    const v = vars[name.toLowerCase()]
    return v !== undefined ? v : match
  })
}

export function previewVarMap(): Record<string, string> {
  return Object.fromEntries(TEMPLATE_VARS.map(v => [v.key, v.sample]))
}
