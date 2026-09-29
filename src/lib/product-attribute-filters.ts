export type AdvancedFilterFieldType = 'select' | 'range' | 'date-range' | 'toggle' | 'boolean' | 'text' | 'multi-select' | 'value-help'

export interface AdvancedFilterField {
  name: string | [string, string]
  label: string
  type: AdvancedFilterFieldType
  options?: { value: string; label: string }[]
  section?: string
  placeholder?: string
  unit?: string
}

// Value-help picks are joined with a pipe: standards and specs often contain commas.
const VALUE_SEPARATOR = '|'

export function splitFilterValues(raw: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? '']).flatMap(r => r.split(VALUE_SEPARATOR))
  return [...new Set(parts.map(v => v.trim()).filter(Boolean))]
}

export function joinFilterValues(values: string[]): string {
  return values.join(VALUE_SEPARATOR)
}

export const SPEC_PARAM_PREFIX = 'spec.'
export const SPEC_SECTION = 'Technical Specifications'

/** Canonical spec keys never contain underscores, so the URL form swaps spaces for them losslessly. */
export function specParam(canonicalKey: string): string {
  return SPEC_PARAM_PREFIX + canonicalKey.replace(/ /g, '_')
}

export function specKeyFromParam(param: string): string | null {
  if (!param.startsWith(SPEC_PARAM_PREFIX)) return null
  const key = param.slice(SPEC_PARAM_PREFIX.length).replace(/_/g, ' ').trim()
  return key && key.length <= 120 ? key : null
}

const YES_NO = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]
const vh = (name: string, label: string, section: string): AdvancedFilterField =>
  ({ name, label, type: 'value-help', section, placeholder: `Any ${label.toLowerCase()}` })

/** Every product-list filter; the Controls page offers the same set. Technical-spec fields are added per store. */
export const ADMIN_PRODUCT_FILTER_FIELDS: AdvancedFilterField[] = [
  { name: 'is_featured', label: 'Featured', type: 'boolean', section: 'Product Type' },
  { name: 'has_variants', label: 'Has Variants', type: 'boolean', section: 'Product Type' },
  { name: 'is_digital', label: 'Digital Product', type: 'boolean', section: 'Product Type' },
  { name: 'is_bundle', label: 'Bundle', type: 'boolean', section: 'Product Type' },
  { name: 'is_subscription', label: 'Subscription', type: 'boolean', section: 'Product Type' },
  { name: 'condition', label: 'Condition', type: 'toggle', section: 'Product Type', options: [{ value: 'new', label: 'New' }, { value: 'used', label: 'Used' }, { value: 'refurbished', label: 'Refurbished' }] },
  vh('ai_product_type', 'Product Type (AI)', 'Product Type'),
  vh('variant_type', 'Variant Type', 'Product Type'),
  vh('supplier', 'Supplier', 'Product Type'),
  vh('sell_unit', 'Selling Unit', 'Product Type'),
  vh('data_source', 'Source', 'Product Type'),

  { name: ['price_min', 'price_max'], label: 'Price Range', type: 'range', section: 'Pricing & Tax', unit: '₹' },
  { name: ['mrp_min', 'mrp_max'], label: 'MRP Range', type: 'range', section: 'Pricing & Tax', unit: '₹' },
  { name: ['discount_min', 'discount_max'], label: 'Discount (%)', type: 'range', section: 'Pricing & Tax' },
  { name: 'gst_percentage', label: 'GST %', type: 'multi-select', section: 'Pricing & Tax', options: [{ value: '0', label: '0%' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }] },
  vh('hsn_code', 'HSN Code', 'Pricing & Tax'),
  vh('tax_class', 'Tax Class', 'Pricing & Tax'),
  { name: 'is_cod_allowed', label: 'COD Allowed', type: 'boolean', section: 'Pricing & Tax' },
  { name: 'inclusive_tax', label: 'Tax-Inclusive Price', type: 'boolean', section: 'Pricing & Tax' },

  { name: ['stock_min', 'stock_max'], label: 'Stock Quantity', type: 'range', section: 'Inventory & Logistics' },
  { name: 'inventory_sync', label: 'Inventory Sync', type: 'boolean', section: 'Inventory & Logistics' },
  { name: 'shipping_class', label: 'Shipping Class', type: 'multi-select', section: 'Inventory & Logistics', options: [{ value: 'standard', label: 'Standard' }, { value: 'express', label: 'Express' }, { value: 'freight', label: 'Freight' }] },
  { name: 'is_oversized', label: 'Oversized', type: 'boolean', section: 'Inventory & Logistics' },
  vh('country_of_origin', 'Country of Origin', 'Inventory & Logistics'),
  vh('package_type', 'Package Type', 'Inventory & Logistics'),
  { name: ['weight_min', 'weight_max'], label: 'Shipping Weight (g)', type: 'range', section: 'Inventory & Logistics' },
  { name: ['handling_min', 'handling_max'], label: 'Handling Days', type: 'range', section: 'Inventory & Logistics' },

  { name: 'fragile', label: 'Fragile', type: 'boolean', section: 'Product Flags' },
  { name: 'hazardous', label: 'Hazardous', type: 'boolean', section: 'Product Flags' },
  { name: 'flammable', label: 'Flammable', type: 'boolean', section: 'Product Flags' },
  { name: 'perishable', label: 'Perishable', type: 'boolean', section: 'Product Flags' },
  { name: 'serialized', label: 'Serialized', type: 'boolean', section: 'Product Flags' },
  { name: 'is_searchable', label: 'Searchable', type: 'toggle', section: 'Product Flags', options: YES_NO },

  vh('grade', 'Grade', 'Specifications'),
  vh('material', 'Material', 'Specifications'),
  vh('finish', 'Finish', 'Specifications'),
  vh('color', 'Color', 'Specifications'),
  vh('size', 'Size', 'Specifications'),
  vh('compliance_standard', 'Compliance Standard', 'Specifications'),
  vh('safety_rating', 'Safety Rating', 'Specifications'),
  vh('certifications', 'Certifications', 'Specifications'),
  vh('brand_part_number', 'Part Number', 'Specifications'),

  { name: ['warranty_min', 'warranty_max'], label: 'Warranty (months)', type: 'range', section: 'Warranty & Audience' },
  vh('warranty_type', 'Warranty Type', 'Warranty & Audience'),
  vh('target_gender', 'Target Gender', 'Warranty & Audience'),
  vh('target_audience', 'Target Audience', 'Warranty & Audience'),

  vh('license_type', 'License Type', 'Digital'),
  vh('file_format', 'File Format', 'Digital'),
  vh('platform_compatibility', 'Platform Compatibility', 'Digital'),

  { name: ['created_from', 'created_to'], label: 'Added On', type: 'date-range', section: 'Dates' },
]

export function filterParamNames(field: AdvancedFilterField): string[] {
  return Array.isArray(field.name) ? field.name : [field.name]
}
