import type { FilterField, FilterOption } from '@jeffi/list-filters/client'
import { ADMIN_PRODUCT_FILTER_FIELDS } from '@/lib/catalog/product-attribute-filters-shared'

// Products list filters (client-safe). Category and brand options and the technical-spec fields
// come from the store, so the page builds the list; the SQL is in ../entities/products.ts.

export const PRODUCT_QUICK_PARAMS = ['category_id', 'brand_id', 'is_active', 'stock'] as const

export function productFields(
  categories: FilterOption[],
  brands: FilterOption[],
  specFields: FilterField[] = []
): FilterField[] {
  return [
    { name: 'category_id', label: 'Category', type: 'select', quick: true, section: 'Catalogue', options: categories },
    { name: 'brand_id', label: 'Brand', type: 'select', quick: true, section: 'Catalogue', options: brands },
    {
      name: 'is_active',
      label: 'Status',
      type: 'toggle',
      quick: true,
      section: 'Catalogue',
      options: [
        { value: 'true', label: 'Active' },
        { value: 'false', label: 'Inactive' },
      ],
    },
    {
      name: 'stock',
      label: 'Stock',
      type: 'toggle',
      quick: true,
      section: 'Catalogue',
      options: [
        { value: 'low', label: 'Low Stock' },
        { value: 'out', label: 'Out of Stock' },
      ],
    },
    ...ADMIN_PRODUCT_FILTER_FIELDS,
    ...specFields,
  ]
}

export const PRODUCT_SEARCH = { placeholder: 'Search by name or SKU...', param: 'search', suggestType: 'products' }
