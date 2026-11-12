// Product columns edited as plain form fields (uncontrolled inputs named after the column).
// Shared by the form, the edit action and publish; safe to import from client components.

export type ExtraFieldType = 'text' | 'textarea' | 'int' | 'numeric' | 'bool' | 'list' | 'select' | 'month' | 'url'

export interface ExtraField {
  key: string
  label: string
  type: ExtraFieldType
  group: ExtraGroup
  max?: number
  placeholder?: string
  hint?: string
  options?: { value: string; label: string }[]
}

export type ExtraGroup = 'overview' | 'legal' | 'commercial' | 'usage' | 'shipping' | 'digital' | 'subscription' | 'seo' | 'internal'

export const EXTRA_GROUP_LABEL: Record<ExtraGroup, string> = {
  overview: 'Overview',
  legal: 'Legal Metrology declarations',
  commercial: 'Commercial',
  usage: 'Usage & care',
  shipping: 'Shipping',
  digital: 'Digital',
  subscription: 'Subscription',
  seo: 'SEO',
  internal: 'Internal (never shown to shoppers)',
}

export const EXTRA_FIELDS: ExtraField[] = [
  { key: 'short_description', label: 'Short description', type: 'textarea', group: 'overview', max: 500, hint: 'One or two lines shown near the price.' },
  { key: 'dimensions', label: 'Dimensions', type: 'text', group: 'overview', max: 100, placeholder: 'e.g. 120 × 45 × 30 mm' },
  { key: 'model_number', label: 'Model number', type: 'text', group: 'commercial', max: 100 },
  { key: 'series', label: 'Series', type: 'text', group: 'commercial', max: 100 },
  { key: 'pack_size', label: 'Pack size', type: 'text', group: 'commercial', max: 100, placeholder: 'e.g. Pack of 10' },
  { key: 'moq', label: 'Minimum order quantity', type: 'int' , group: 'commercial' },
  { key: 'lead_time_days', label: 'Lead time (days)', type: 'int', group: 'commercial' },
  { key: 'return_window_days', label: 'Return window (days)', type: 'int', group: 'commercial' },
  { key: 'replacement_policy', label: 'Replacement policy', type: 'textarea', group: 'commercial' },
  { key: 'manufacturer_name', label: 'Manufacturer', type: 'text', group: 'legal', max: 255 },
  { key: 'manufacturer_address', label: 'Manufacturer address', type: 'textarea', group: 'legal' },
  { key: 'packer_name', label: 'Packer', type: 'text', group: 'legal', max: 255 },
  { key: 'packer_address', label: 'Packer address', type: 'textarea', group: 'legal' },
  { key: 'importer_name', label: 'Importer', type: 'text', group: 'legal', max: 255 },
  { key: 'importer_address', label: 'Importer address', type: 'textarea', group: 'legal' },
  { key: 'consumer_care', label: 'Consumer care', type: 'textarea', group: 'legal', placeholder: 'Phone, email and address for complaints' },
  { key: 'mfg_month_year', label: 'Month & year of manufacture', type: 'month', group: 'legal' },
  { key: 'net_quantity', label: 'Net quantity', type: 'numeric', group: 'legal' },
  {
    key: 'net_quantity_unit',
    label: 'Net quantity unit',
    type: 'select',
    group: 'legal',
    options: ['g', 'kg', 'ml', 'l', 'mm', 'cm', 'm', 'pcs', 'pair', 'set'].map(v => ({ value: v, label: v })),
  },
  { key: 'best_before', label: 'Best before', type: 'text', group: 'legal', max: 100, placeholder: 'e.g. 12 months from manufacture' },
  { key: 'in_the_box', label: "What's in the box", type: 'textarea', group: 'usage', hint: 'One item per line.' },
  { key: 'usage_instructions', label: 'Usage instructions', type: 'textarea', group: 'usage' },
  { key: 'care_instructions', label: 'Care instructions', type: 'textarea', group: 'usage' },
  { key: 'safety_warnings', label: 'Safety warnings', type: 'textarea', group: 'usage' },
  { key: 'volumetric_weight_grams', label: 'Volumetric weight (g)', type: 'int', group: 'shipping', hint: 'Override; blank uses L×B×H ÷ 5000.' },
  { key: 'downloadable', label: 'Files downloadable by default', type: 'bool', group: 'digital' },
  {
    key: 'age_rating',
    label: 'Age rating',
    type: 'select',
    group: 'digital',
    options: ['U', 'U/A 7+', 'U/A 13+', 'U/A 16+', 'A', '3+', '7+', '12+', '16+', '18+'].map(v => ({ value: v, label: v })),
  },
  { key: 'subscription_price_ex_gst', label: 'Subscription price (ex GST)', type: 'numeric', group: 'subscription' },
  {
    key: 'subscription_discount_type',
    label: 'Subscription discount',
    type: 'select',
    group: 'subscription',
    options: [
      { value: 'percent', label: 'Percent off' },
      { value: 'flat', label: 'Flat amount off' },
    ],
  },
  { key: 'subscription_discount_value', label: 'Discount value', type: 'numeric', group: 'subscription' },
  { key: 'meta_keywords', label: 'Meta keywords', type: 'list', group: 'seo', hint: 'Comma separated.' },
  { key: 'internal_notes', label: 'Internal notes', type: 'textarea', group: 'internal' },
  { key: 'source_url', label: 'Source URL', type: 'url', group: 'internal', placeholder: 'https://' },
]

export const EXTRA_FIELD_KEYS = EXTRA_FIELDS.map(f => f.key)

const fieldOf = new Map(EXTRA_FIELDS.map(f => [f.key, f]))

/** One value as the form shows it (string), from a stored value. */
export function extraFieldInput(key: string, v: unknown): string {
  if (v == null) return ''
  const f = fieldOf.get(key)
  if (f?.type === 'list') return Array.isArray(v) ? v.join(', ') : String(v)
  if (f?.type === 'bool') return v === true || v === 'true' ? 'true' : 'false'
  return String(v)
}

/** The extra fields present in `src` (form strings or stored values), typed for the column. */
export function normalizeExtraFields(src: Record<string, unknown> | ((k: string) => unknown)): Record<string, unknown> {
  const get = typeof src === 'function' ? src : (k: string) => src[k]
  const has = typeof src === 'function' ? (k: string) => src(k) !== undefined : (k: string) => k in src
  const out: Record<string, unknown> = {}
  for (const f of EXTRA_FIELDS) {
    if (!has(f.key)) continue
    const raw = get(f.key)
    if (raw == null) {
      out[f.key] = f.type === 'bool' ? false : null
      continue
    }
    const s = Array.isArray(raw) ? raw : String(raw).trim()
    switch (f.type) {
      case 'int': {
        const n = parseInt(String(s), 10)
        out[f.key] = Number.isFinite(n) && n >= 0 ? n : null
        break
      }
      case 'numeric': {
        const n = parseFloat(String(s))
        out[f.key] = Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null
        break
      }
      case 'bool':
        out[f.key] = raw === true || s === 'true' || s === 'on'
        break
      case 'list':
        out[f.key] = (Array.isArray(s) ? s.map(String) : String(s).split(','))
          .map(x => x.trim())
          .filter(Boolean)
          .slice(0, 50)
        if ((out[f.key] as string[]).length === 0) out[f.key] = null
        break
      case 'month':
        out[f.key] = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s)) ? s : null
        break
      case 'url':
        out[f.key] = /^https?:\/\//i.test(String(s)) ? String(s).slice(0, 2000) : null
        break
      default: {
        const t = String(s)
        out[f.key] = t ? (f.max ? t.slice(0, f.max) : t) : null
        if (f.type === 'select' && t && f.options && !f.options.some(o => o.value === t)) out[f.key] = null
      }
    }
  }
  return out
}

/** SET list for the extra columns from a jsonb param (jsonb_populate_record casts each). */
export function extraFieldsSetSql(keys: string[], param: string): string {
  const cols = keys.filter(k => fieldOf.has(k))
  if (cols.length === 0) return ''
  return `(${cols.join(', ')}) = (SELECT ${cols.map(c => `r.${c}`).join(', ')} FROM jsonb_populate_record(NULL::products, ${param}) r)`
}
