import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Brands list filters (client-safe; the SQL is in ../entities/brands.ts).

const YES_NO: FilterOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const BRAND_FIELDS = defineFields({
  active: {
    label: 'Status',
    type: 'toggle',
    quick: true,
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
    section: 'Brand',
  },
  has_logo: { label: 'Has logo', type: 'toggle', options: YES_NO, section: 'Brand' },
  has_website: { label: 'Has website', type: 'toggle', options: YES_NO, section: 'Brand' },
  return_allowed: { label: 'Returns allowed', type: 'toggle', options: YES_NO, section: 'Policy' },
  replacement_allowed: { label: 'Replacements allowed', type: 'toggle', options: YES_NO, section: 'Policy' },
  products: { label: 'Active products', type: 'range', section: 'Products' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range', section: 'Products' },
})

export const BRAND_ALIASES: FilterAlias[] = [{ param: 'is_active', to: 'active' }]

export const BRAND_SEARCH = { placeholder: 'Search by name...', param: 'search', suggestType: 'brands' }
