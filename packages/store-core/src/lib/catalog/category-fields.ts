// Category profile columns (docs/BRAND_CATEGORY_PLAN.md §3.2). Client-safe.
import type { FieldSpec } from './entity-fields'
import { ENUMS } from '@/lib/import/enums'

const opts = (values: string[]) =>
  values.filter(Boolean).map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') }))

export const CATEGORY_PROFILE_FIELDS: FieldSpec[] = [
  { key: 'short_name', label: 'Short name', kind: 'text', max: 40, section: 'Display', hint: 'Menu and app tab label.' },
  { key: 'tagline', label: 'Tagline', kind: 'text', max: 160, section: 'Display' },
  { key: 'show_in_nav', label: 'Show in menus', kind: 'bool', section: 'Display', fallback: true },
  { key: 'is_featured', label: 'Featured category', kind: 'bool', section: 'Display', fallback: false },
  { key: 'banner_link_url', label: 'Banner link', kind: 'url', section: 'Display', hint: 'Where a click on the banner goes.' },
  {
    key: 'default_sort',
    label: 'Default sort',
    kind: 'select',
    section: 'Display',
    hint: 'Empty means Featured.',
    // Keys the listing's ?sort= accepts (lib/catalog/product-sort.ts).
    options: [
      { value: 'created_at', label: 'Newest' },
      { value: 'price', label: 'Price: low to high' },
      { value: 'name', label: 'Name' },
      { value: 'discount', label: 'Biggest discount' },
    ],
  },
  {
    key: 'listing_layout',
    label: 'Listing layout',
    kind: 'select',
    section: 'Display',
    fallback: 'grid',
    options: [
      { value: 'grid', label: 'Grid' },
      { value: 'table', label: 'Spec table' },
    ],
  },

  { key: 'meta_title', label: 'SEO title', kind: 'text', max: 160, section: 'SEO' },
  { key: 'meta_description', label: 'SEO description', kind: 'longtext', max: 320, section: 'SEO' },
  { key: 'seo_content', label: 'Buying guide', kind: 'longtext', section: 'SEO', hint: 'Shown below the products.' },
  { key: 'seo_noindex', label: 'Hide from search engines', kind: 'bool', section: 'SEO', fallback: false },
  {
    key: 'product_title_template',
    label: 'Product title template',
    kind: 'text',
    max: 255,
    section: 'SEO',
    placeholder: '{brand} {name} {size}',
    hint: 'Used to suggest product titles.',
  },

  { key: 'default_hsn_code', label: 'Default HSN', kind: 'text', max: 8, section: 'Tax', hint: 'New products start with this; invoices fall back to it.' },
  { key: 'hsn_prefixes', label: 'Allowed HSN prefixes', kind: 'list', section: 'Tax', hint: 'Comma separated, e.g. 7318, 8204. A product HSN outside these is flagged.' },
  { key: 'default_gst_rate', label: 'Default GST %', kind: 'decimal', min: 0, maxValue: 100, section: 'Tax' },
  { key: 'default_uqc', label: 'Unit quantity code', kind: 'text', max: 3, section: 'Tax', placeholder: 'NOS', hint: 'GSTR-1 HSN summary unit (NOS, PCS, KGS, MTR).' },
  { key: 'default_tax_class', label: 'Tax class', kind: 'select', section: 'Tax', options: opts(ENUMS.tax_class) },

  { key: 'default_handling_days', label: 'Handling days', kind: 'int', min: 0, maxValue: 60, section: 'Fulfilment' },
  { key: 'default_shipping_class', label: 'Shipping class', kind: 'select', section: 'Fulfilment', options: opts(ENUMS.shipping_class) },
  { key: 'default_package_type', label: 'Package type', kind: 'select', section: 'Fulfilment', options: opts(ENUMS.package_type) },
  { key: 'cod_allowed', label: 'Cash on delivery', kind: 'tristate', section: 'Fulfilment', hint: 'Default for new products.' },
  { key: 'non_returnable_reason', label: 'Why not returnable', kind: 'text', section: 'Fulfilment', hint: 'Shown when returns are off.' },
]

type CategoryRow = { id: string; parent_category_id: string | null } & Record<string, any>

/** The category's own defaults, each falling back to its ancestors'; hsn_prefixes likewise. */
export function resolveCategoryDefaults(categories: CategoryRow[], categoryId: string | null | undefined) {
  const byId = new Map(categories.map(c => [c.id, c]))
  const chain: CategoryRow[] = []
  for (let c = categoryId ? byId.get(categoryId) : undefined; c && chain.length < 10; c = c.parent_category_id ? byId.get(c.parent_category_id) : undefined)
    chain.push(c)
  const pick = (k: string) => chain.map(c => c[k]).find(v => v != null && v !== '') ?? null
  const out: Record<string, unknown> = Object.fromEntries(Object.keys(CATEGORY_PRODUCT_DEFAULTS).map(k => [k, pick(k)]))
  const prefixes = chain.map(c => c.hsn_prefixes).find(p => Array.isArray(p) && p.length) as string[] | undefined
  return { ...out, hsn_prefixes: prefixes ?? [] } as Record<string, any> & { hsn_prefixes: string[] }
}

/** True when the HSN is empty, no prefixes are set, or it starts with one of them. */
export const hsnMatchesPrefixes = (hsn: string | null | undefined, prefixes: string[]) =>
  !hsn?.trim() || !prefixes.length || prefixes.some(p => hsn.trim().startsWith(p.trim()))

/** Category columns a new product starts with (category column → product column). */
export const CATEGORY_PRODUCT_DEFAULTS: Record<string, string> = {
  default_hsn_code: 'hsn_code',
  default_gst_rate: 'gst_percentage',
  default_tax_class: 'tax_class',
  default_handling_days: 'handling_days',
  default_shipping_class: 'shipping_class',
  default_package_type: 'package_type',
  cod_allowed: 'is_cod_allowed',
}
