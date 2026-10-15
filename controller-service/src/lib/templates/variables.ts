import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import {
  BUILTIN_TEMPLATE_VARIABLES,
  BUILTIN_VARIABLE_KEYS,
  findTokenKeys,
  renderTemplate,
  type TemplateVariableDef,
} from './variables-shared'

export * from './variables-shared'

export interface CustomTemplateVariable {
  id: string
  key: string
  label: string
  description: string
  value: string
  isEnabled: boolean
}

interface StoreValues {
  name: string
  email: string
  phone: string
  web: string
}

export interface TemplateVariableContext {
  recipient: { email: string; first_name?: string | null; last_name?: string | null; phone?: string | null }
  store?: Partial<StoreValues>
  extra?: Record<string, string>
}

export async function listCustomTemplateVariables(): Promise<CustomTemplateVariable[]> {
  const rows = await queryMany<{
    id: string
    key: string
    label: string
    description: string | null
    value: string
    is_enabled: boolean
  }>(`SELECT id, key, label, description, value, is_enabled FROM template_variables ORDER BY key`)
  return (rows || []).map(r => ({
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description || '',
    value: r.value ?? '',
    isEnabled: r.is_enabled,
  }))
}

async function enabledCustom(): Promise<CustomTemplateVariable[]> {
  try {
    return (await listCustomTemplateVariables()).filter(v => v.isEnabled && !BUILTIN_VARIABLE_KEYS.has(v.key))
  } catch {
    // Table missing / DB hiccup: built-ins still resolve.
    return []
  }
}

export async function listTemplateVariables(): Promise<TemplateVariableDef[]> {
  const custom = await enabledCustom()
  return [
    ...BUILTIN_TEMPLATE_VARIABLES,
    ...custom.map(c => ({
      key: c.key,
      label: c.label,
      description: c.description,
      group: 'custom' as const,
      sample: c.value,
      builtIn: false,
    })),
  ]
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Every blank field is filled from the configured identity, so a configured store never mails a blank name.
async function loadStore(given: Partial<StoreValues> | undefined): Promise<StoreValues> {
  const s: StoreValues = {
    name: given?.name?.trim() || '',
    email: given?.email?.trim() || '',
    phone: given?.phone?.trim() || '',
    web: given?.web?.trim() || '',
  }
  if (s.name && s.email && s.phone && s.web) return s
  try {
    const { getStoreIdentity } = await import('@/lib/catalog/site-controls')
    const id = await getStoreIdentity()
    s.name ||= id?.name?.trim() || ''
    s.email ||= id?.email?.trim() || ''
    s.phone ||= id?.phone?.trim() || ''
    s.web ||= id?.web?.trim() || ''
  } catch {}
  if (!s.name || !s.web) {
    try {
      const brand = await import('@/lib/catalog/brand')
      if (!s.name) s.name = (await brand.currentBrandNameAsync())?.trim() || ''
      if (!s.web) s.web = hostOf((await brand.storeBaseUrlAsync()) || '')
    } catch {}
  }
  return s
}

function varMap(ctx: TemplateVariableContext, store: StoreValues, custom: CustomTemplateVariable[]) {
  const r = ctx.recipient
  const first = (r.first_name || '').trim()
  const last = (r.last_name || '').trim()
  const vars: Record<string, string> = {
    customer_first_name: first || 'there',
    customer_last_name: last,
    customer_name: [first, last].filter(Boolean).join(' ') || 'there',
    customer_email: r.email || '',
    store_name: store.name,
    store_email: store.email,
    store_phone: store.phone,
    store_web: store.web,
    current_year: String(new Date().getFullYear()),
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    order_number: '',
  }
  for (const c of custom) vars[c.key] = c.value
  return { ...vars, ...(ctx.extra || {}) }
}

export async function resolveTemplateVariables(ctx: TemplateVariableContext): Promise<Record<string, string>> {
  const [store, custom] = await Promise.all([loadStore(ctx.store), enabledCustom()])
  return varMap(ctx, store, custom)
}

/** Loads store identity + custom vars once; returns a per-recipient resolver for bulk sends. */
export async function createTemplateVariableResolver(
  store?: Partial<StoreValues>
): Promise<(ctx: Omit<TemplateVariableContext, 'store'>) => Record<string, string>> {
  const [s, custom] = await Promise.all([loadStore(store), enabledCustom()])
  return ctx => varMap(ctx, s, custom)
}

export interface OutgoingMail {
  subject: string
  html?: string
  amp?: string
  text?: string
}

/**
 * Last line of defence before a mail leaves: any registered variable token still present in the
 * subject / html / amp / text is substituted and a warning logged. Unregistered tokens are untouched.
 */
export async function guardTemplateTokens<T extends OutgoingMail>(
  mail: T,
  ctx: { to: string; userId?: string | null; templateName?: string | null }
): Promise<T> {
  const parts = [mail.subject, mail.html, mail.amp, mail.text].filter((p): p is string => !!p)
  const keys = new Set(parts.flatMap(findTokenKeys))
  if (keys.size === 0) return mail

  const needsCustom = [...keys].some(k => !BUILTIN_VARIABLE_KEYS.has(k))
  const custom = needsCustom ? await enabledCustom() : []
  const customKeys = new Set(custom.map(c => c.key))
  const leaked = [...keys].filter(k => BUILTIN_VARIABLE_KEYS.has(k) || customKeys.has(k))
  if (leaked.length === 0) return mail

  let recipient: TemplateVariableContext['recipient'] = { email: ctx.to }
  if (ctx.userId) {
    try {
      const u = await queryOne<{ first_name: string | null; last_name: string | null }>(
        `SELECT first_name, last_name FROM users WHERE id = $1`,
        [ctx.userId]
      )
      if (u) recipient = { ...recipient, ...u }
    } catch {}
  }
  const vars = varMap({ recipient }, await loadStore(undefined), custom)
  const only = Object.fromEntries(leaked.map(k => [k, vars[k] ?? '']))
  console.warn('[mail] unresolved template variables substituted before send', {
    template: ctx.templateName ?? null,
    keys: leaked,
  })
  return {
    ...mail,
    subject: renderTemplate(mail.subject, only),
    ...(mail.html ? { html: renderTemplate(mail.html, only, { escape: true }) } : {}),
    ...(mail.amp ? { amp: renderTemplate(mail.amp, only, { escape: true }) } : {}),
    ...(mail.text ? { text: renderTemplate(mail.text, only) } : {}),
  }
}
