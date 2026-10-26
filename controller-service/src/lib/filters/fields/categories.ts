import { defineFields, type FilterAlias, type FilterOption } from '@jeffi/list-filters/client'

// Categories list filters (client-safe; the SQL is in ../entities/categories.ts).

const YES_NO: FilterOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]

export const CATEGORY_FIELDS = defineFields({
  active: {
    label: 'Status',
    type: 'toggle',
    quick: true,
    options: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
    section: 'Category',
  },
  level: {
    label: 'Type',
    type: 'select',
    quick: true,
    options: [
      { value: 'main', label: 'Main categories' },
      { value: 'sub', label: 'Subcategories' },
    ],
    section: 'Category',
  },
  parent: {
    label: 'Parent category',
    type: 'value-help',
    placeholder: 'Any parent',
    noun: 'Categories',
    section: 'Category',
  },
  has_image: { label: 'Has image', type: 'toggle', options: YES_NO, section: 'Category' },
  google_category: { label: 'Google category set', type: 'toggle', options: YES_NO, section: 'Category' },
  return_allowed: { label: 'Returns allowed', type: 'toggle', options: YES_NO, section: 'Policy' },
  replacement_allowed: { label: 'Replacements allowed', type: 'toggle', options: YES_NO, section: 'Policy' },
  products: { label: 'Active products', type: 'range', section: 'Products' },
  created: { name: ['from', 'to'], label: 'Created', type: 'date-range', section: 'Products' },
})

export const CATEGORY_ALIASES: FilterAlias[] = [
  { param: 'is_active', to: 'active' },
  { param: 'type', to: 'level' },
]

export const CATEGORY_SEARCH = { placeholder: 'Search by name...', param: 'search', suggestType: 'categories' }
