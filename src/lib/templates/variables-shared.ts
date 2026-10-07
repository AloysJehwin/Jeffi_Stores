// Client-safe: variable definitions and the one renderer every email path uses.

export interface TemplateVariableDef {
  key: string
  label: string
  description: string
  group: 'customer' | 'store' | 'date' | 'order' | 'custom'
  sample: string
  builtIn: boolean
}

export const VARIABLE_KEY_RE = /^[a-z_][a-z0-9_]*$/

export const BUILTIN_TEMPLATE_VARIABLES: TemplateVariableDef[] = [
  {
    key: 'customer_first_name',
    label: 'First name',
    description: "Recipient's first name (falls back to 'there')",
    group: 'customer',
    sample: 'Aloys',
    builtIn: true,
  },
  {
    key: 'customer_last_name',
    label: 'Last name',
    description: "Recipient's last name (empty if not on file)",
    group: 'customer',
    sample: 'Jehwin',
    builtIn: true,
  },
  {
    key: 'customer_name',
    label: 'Full name',
    description: "Recipient's full name (first + last)",
    group: 'customer',
    sample: 'Aloys Jehwin',
    builtIn: true,
  },
  {
    key: 'customer_email',
    label: 'Email',
    description: "Recipient's email address",
    group: 'customer',
    sample: 'customer@example.com',
    builtIn: true,
  },
  {
    key: 'store_name',
    label: 'Store name',
    description: 'Configured store / business name',
    group: 'store',
    sample: 'Your Store',
    builtIn: true,
  },
  {
    key: 'store_email',
    label: 'Store email',
    description: 'Configured store contact email',
    group: 'store',
    sample: 'hello@yourstore.in',
    builtIn: true,
  },
  {
    key: 'store_phone',
    label: 'Store phone',
    description: 'Configured store contact phone',
    group: 'store',
    sample: '+91 90000 00000',
    builtIn: true,
  },
  {
    key: 'store_web',
    label: 'Store URL',
    description: 'Customer-facing site URL',
    group: 'store',
    sample: 'yourstore.in',
    builtIn: true,
  },
  {
    key: 'current_year',
    label: 'Year',
    description: 'Current 4-digit year',
    group: 'date',
    sample: String(new Date().getFullYear()),
    builtIn: true,
  },
  {
    key: 'date',
    label: 'Today',
    description: 'Today in DD Mon YYYY format',
    group: 'date',
    sample: '15 Jun 2026',
    builtIn: true,
  },
  {
    key: 'order_number',
    label: 'Order number',
    description: 'Order number (only in order emails; empty elsewhere)',
    group: 'order',
    sample: 'ORD-10234',
    builtIn: true,
  },
]

export const BUILTIN_VARIABLE_KEYS = new Set(BUILTIN_TEMPLATE_VARIABLES.map(v => v.key))

export function sampleVariableMap(defs: TemplateVariableDef[] = BUILTIN_TEMPLATE_VARIABLES): Record<string, string> {
  return Object.fromEntries(defs.map(v => [v.key, v.sample]))
}

// `{key}` and `{{ key }}`, whitespace tolerant, any case.
export const TOKEN_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}|\{\s*([a-z_][a-z0-9_]*)\s*\}/gi

// Tolerant form: braces may be entities, and editor markup / &nbsp; may sit inside the token.
const OPEN = '(?:\\{|&#123;|&#x7b;|&lbrace;)'
const CLOSE = '(?:\\}|&#125;|&#x7d;|&rbrace;)'
const TAG = '<[^<>]*>'
const GAP = `(?:\\s|&nbsp;|&#160;|&#xa0;|${TAG})*`
const LOOSE_SRC = `${OPEN}${OPEN}?${GAP}([a-z_](?:[a-z0-9_]|${TAG})*)${GAP}${CLOSE}${CLOSE}?`
const looseRe = () => new RegExp(LOOSE_SRC, 'gi')

// The old editor's chip: a styled <span> around nothing but a token. New editor chips carry data-variable.
const CHIP_RE = /<span\b[^>]*\bdata-variable\s*=\s*["']([a-z_][a-z0-9_]*)["'][^>]*>[\s\S]*?<\/span>/gi
const SPACE = '(?:\\s|&nbsp;|&#160;|&#xa0;)*'
const WRAPPED_TOKEN_RE = new RegExp(
  `<span\\b[^>]*>(${SPACE}${OPEN}${OPEN}?\\s*[a-z_][a-z0-9_]*\\s*${CLOSE}${CLOSE}?${SPACE})</span>`,
  'gi'
)

const TAG_RE = /<[^<>]*>/g

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function makeLookup(vars: Record<string, string | number | null | undefined>) {
  const lower = new Map<string, string>()
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || v === null) continue
    if (!lower.has(k.toLowerCase())) lower.set(k.toLowerCase(), String(v))
  }
  return (key: string): string | undefined => {
    const exact = vars[key]
    if (exact !== undefined && exact !== null) return String(exact)
    return lower.get(key.toLowerCase())
  }
}

export interface RenderOptions {
  // HTML-escape substituted values (use for html bodies, not subjects or plain text).
  escape?: boolean
}

/**
 * Substitutes `{key}` and `{{ key }}` for every key in `vars` (any case, whitespace tolerant,
 * entity-encoded braces, editor tags inside the token, legacy chip spans). Tokens whose key is not
 * in `vars` are left untouched; a key mapped to '' renders as ''.
 */
export function renderTemplate(
  input: string,
  vars: Record<string, string | number | null | undefined>,
  opts: RenderOptions = {}
): string {
  if (!input) return input
  const lookup = makeLookup(vars)
  const out = (v: string) => (opts.escape ? escapeHtml(v) : v)

  let s = input.replace(CHIP_RE, (m, key: string) => {
    const v = lookup(key)
    return v !== undefined ? out(v) : `{${key}}`
  })

  s = s.replace(WRAPPED_TOKEN_RE, (m, inner: string) => {
    const key = tokenKey(inner)
    return key && lookup(key) !== undefined ? inner : m
  })

  return s.replace(looseRe(), (m, rawKey: string) => {
    const key = rawKey.replace(TAG_RE, '')
    const v = lookup(key)
    if (v === undefined) return m
    // Keep any markup swallowed by the match so surrounding tags stay balanced.
    const tags = m.match(TAG_RE)
    return out(v) + (tags ? tags.join('') : '')
  })
}

function tokenKey(fragment: string): string | null {
  const m = new RegExp(LOOSE_SRC, 'i').exec(fragment)
  return m ? m[1].replace(TAG_RE, '') : null
}

/** Lower-cased keys of every token-shaped fragment in `input` (both syntaxes, tolerant form). */
export function findTokenKeys(input: string): string[] {
  if (!input) return []
  const keys = new Set<string>()
  for (const m of input.matchAll(looseRe())) keys.add(m[1].replace(TAG_RE, '').toLowerCase())
  for (const m of input.matchAll(CHIP_RE)) keys.add(m[1].toLowerCase())
  return [...keys]
}

/** Blanks remaining `{{ key }}` tokens; scenario templates collapse their unset single-brace vars separately. */
export function stripDoubleBraceTokens(input: string): string {
  if (!input) return input
  return input.replace(/\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/gi, '')
}

// `{#if key}…{#else}…{/if}`: the block renders when the var is set and not '' / '0'. Nests; an
// unknown key counts as unset. Runs before token substitution.
const IF_BLOCK_RE =
  /\{#if\s+([a-z_][a-z0-9_]*)\s*\}((?:(?!\{#if\s)[\s\S])*?)(?:\{#else\}((?:(?!\{#if\s)[\s\S])*?))?\{\/if\}/i

export function isTruthyVar(v: string | number | null | undefined): boolean {
  if (v === undefined || v === null) return false
  const s = String(v).trim()
  return s !== '' && s !== '0'
}

export function renderConditionals(input: string, vars: Record<string, string | number | null | undefined>): string {
  if (!input || !input.includes('{#if')) return input
  const lookup = makeLookup(vars)
  let s = input
  for (let guard = 0; guard < 200; guard++) {
    const m = IF_BLOCK_RE.exec(s)
    if (!m) break
    const out = isTruthyVar(lookup(m[1])) ? m[2] : (m[3] ?? '')
    s = s.slice(0, m.index) + out + s.slice(m.index + m[0].length)
  }
  return s
}
