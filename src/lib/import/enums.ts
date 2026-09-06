import type { PackageType } from '@/lib/shipping'

// Dropdown value sets for the import template. Only stock_status is DB-enforced
// (CHECK in catalog.sql); the rest mirror the product form's option lists so the
// sheet offers exactly what the editor does. Advisory, not hard-validated on import.

const PACKAGE_TYPES: PackageType[] = [
  'flat_poly_auto', 'flat_poly_s', 'flat_poly_m', 'flat_poly_l', 'flat_poly_xl',
  'drill_bit_tube', 'drill_bit_set_case', 'corrugated_box', 'long_tube',
]

export const ENUMS: Record<string, string[]> = {
  stock_status: ['In Stock', 'Low Stock', 'Out of Stock'],
  package_type: PACKAGE_TYPES,
  condition: ['new', 'refurbished', 'used', 'open_box'],
  target_gender: ['', 'male', 'female', 'unisex'],
  warranty_type: ['', 'manufacturer', 'seller'],
  shipping_class: ['standard', 'express', 'freight', 'cold_chain'],
  tax_class: ['standard', 'reduced', 'zero', 'exempt'],
  subscription_interval: ['', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
  gst_percentage: ['0', '5', '12', '18', '28'],
  unit: ['pcs', 'pair', 'set', 'box', 'pack', 'roll', 'sheet'],
  bool: ['TRUE', 'FALSE'],
}
