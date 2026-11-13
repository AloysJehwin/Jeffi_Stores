// Brand profile columns (docs/BRAND_CATEGORY_PLAN.md §3.1). Client-safe.
import type { FieldSpec } from './entity-fields'
import { ENUMS } from '@/lib/import/enums'

const opts = (values: string[]) =>
  values.filter(Boolean).map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ') }))

export const BRAND_SECTIONS = ['Profile', 'Media', 'Origin & legal', 'Warranty & service', 'SEO'] as const

export const BRAND_PROFILE_FIELDS: FieldSpec[] = [
  { key: 'legal_name', label: 'Legal name', kind: 'text', max: 255, section: 'Profile', hint: 'Registered company that owns the brand.' },
  { key: 'tagline', label: 'Tagline', kind: 'text', max: 160, section: 'Profile' },
  { key: 'story', label: 'Brand story', kind: 'longtext', section: 'Profile', hint: 'Shown as "About" on the brand page.' },
  {
    key: 'brand_type',
    label: 'Brand type',
    kind: 'select',
    section: 'Profile',
    fallback: 'manufacturer',
    options: opts(['manufacturer', 'private_label', 'distributor', 'white_label']),
  },
  { key: 'aliases', label: 'Other spellings', kind: 'list', section: 'Profile', hint: 'Comma separated. Search and imports match these too.' },
  { key: 'founded_year', label: 'Founded', kind: 'int', min: 1700, maxValue: 2100, section: 'Profile' },
  { key: 'headquarters', label: 'Headquarters', kind: 'text', max: 255, section: 'Profile' },
  { key: 'is_featured', label: 'Featured brand', kind: 'bool', section: 'Profile', fallback: false },
  { key: 'display_order', label: 'Display order', kind: 'int', min: 0, section: 'Profile', fallback: 0 },
  { key: 'catalogue_pdf_url', label: 'Catalogue PDF', kind: 'url', section: 'Profile' },
  {
    key: 'social_links',
    label: 'Social links',
    kind: 'links',
    section: 'Profile',
    subkeys: ['instagram', 'youtube', 'facebook', 'linkedin', 'x'],
    fallback: {},
  },

  { key: 'logo_dark_url', label: 'Logo for dark backgrounds', kind: 'url', max: 500, section: 'Media' },
  { key: 'logo_square_url', label: 'Square logo', kind: 'url', max: 500, section: 'Media', hint: 'Used in round chips and the app.' },
  { key: 'banner_desktop_url', label: 'Banner (desktop)', kind: 'url', section: 'Media' },
  { key: 'banner_mobile_url', label: 'Banner (mobile)', kind: 'url', section: 'Media' },
  { key: 'brand_color', label: 'Brand colour', kind: 'color', section: 'Media', placeholder: '#1a73e8' },

  {
    key: 'country_of_origin',
    label: 'Country of origin',
    kind: 'text',
    max: 2,
    section: 'Origin & legal',
    placeholder: 'IN',
    hint: 'Two-letter code. Products without their own use this.',
  },
  { key: 'manufacturer_name', label: 'Manufacturer', kind: 'text', max: 255, section: 'Origin & legal' },
  { key: 'manufacturer_address', label: 'Manufacturer address', kind: 'longtext', section: 'Origin & legal' },
  { key: 'importer_name', label: 'Importer', kind: 'text', max: 255, section: 'Origin & legal' },
  { key: 'importer_address', label: 'Importer address', kind: 'longtext', section: 'Origin & legal' },
  { key: 'packer_name', label: 'Packer', kind: 'text', max: 255, section: 'Origin & legal' },
  { key: 'packer_address', label: 'Packer address', kind: 'longtext', section: 'Origin & legal' },
  { key: 'consumer_care', label: 'Consumer care', kind: 'longtext', section: 'Origin & legal', hint: 'Phone, email or address for complaints.' },

  { key: 'default_warranty_months', label: 'Warranty (months)', kind: 'int', min: 0, maxValue: 600, section: 'Warranty & service' },
  { key: 'default_warranty_type', label: 'Warranty type', kind: 'select', section: 'Warranty & service', options: opts(ENUMS.warranty_type) },
  { key: 'warranty_terms', label: 'Warranty terms', kind: 'longtext', section: 'Warranty & service' },
  { key: 'service_phone', label: 'Service phone', kind: 'text', max: 30, section: 'Warranty & service' },
  { key: 'service_email', label: 'Service email', kind: 'text', max: 255, section: 'Warranty & service' },
  { key: 'service_url', label: 'Service / support page', kind: 'url', max: 500, section: 'Warranty & service' },
  { key: 'default_lead_time_days', label: 'Supply lead time (days)', kind: 'int', min: 0, maxValue: 365, section: 'Warranty & service' },
  { key: 'return_policy_note', label: 'Return policy note', kind: 'longtext', section: 'Warranty & service', hint: 'Shown next to the return window on product pages.' },

  { key: 'meta_title', label: 'SEO title', kind: 'text', max: 160, section: 'SEO' },
  { key: 'meta_description', label: 'SEO description', kind: 'longtext', max: 320, section: 'SEO' },
  { key: 'seo_content', label: 'Page copy', kind: 'longtext', section: 'SEO', hint: 'Shown below the brand page products.' },
  { key: 'seo_noindex', label: 'Hide from search engines', kind: 'bool', section: 'SEO', fallback: false },
]

/** Brand columns a product inherits when it leaves its own blank (brand column → product column). */
export const BRAND_PRODUCT_DEFAULTS: Record<string, string> = {
  country_of_origin: 'country_of_origin',
  manufacturer_name: 'manufacturer_name',
  manufacturer_address: 'manufacturer_address',
  importer_name: 'importer_name',
  importer_address: 'importer_address',
  packer_name: 'packer_name',
  packer_address: 'packer_address',
  consumer_care: 'consumer_care',
  default_warranty_months: 'warranty_months',
  default_warranty_type: 'warranty_type',
  default_lead_time_days: 'lead_time_days',
}
