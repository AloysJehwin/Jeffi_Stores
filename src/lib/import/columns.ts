export type RowType = 'product' | 'variant' | 'sub_variant'
export type Coercer = 'text' | 'number' | 'int' | 'bool' | 'date' | 'csv' | 'json'

export interface ImportColumn {
  key: string
  header: string
  coerce: Coercer
  rowTypes: RowType[]
  required?: boolean
  help?: string
  // Key into ENUMS (src/lib/import/enums.ts) → renders a dropdown in the template.
  // bool columns get the TRUE/FALSE list automatically; no need to set this.
  enumKey?: string
}

// Grouping columns that structure a product + its variants + sub-variants across
// consecutive rows. Not product fields — they wire the hierarchy together.
export const STRUCTURE_COLUMNS: ImportColumn[] = [
  { key: 'row_type', header: 'row_type', coerce: 'text', rowTypes: ['product', 'variant', 'sub_variant'], required: true, help: 'product | variant | sub_variant' },
  { key: 'parent_sku', header: 'parent_sku', coerce: 'text', rowTypes: ['variant', 'sub_variant'], help: 'SKU of the product this row belongs to' },
  { key: 'variant_sku', header: 'variant_sku', coerce: 'text', rowTypes: ['sub_variant'], help: 'SKU of the variant this sub-variant belongs to' },
  { key: 'image_urls', header: 'image_urls', coerce: 'text', rowTypes: ['product'], help: 'Pipe-delimited image URLs: a.jpg|b.jpg — fetched and uploaded on import' },
]

// Product columns — the exact set the publish path writes (product-draft.ts UPDATE
// products SET ...). category/brand/supplier are given by NAME here and resolved to
// ids by the engine; category & brand must already exist or the row errors.
export const PRODUCT_COLUMNS: ImportColumn[] = [
  { key: 'sku', header: 'sku', coerce: 'text', rowTypes: ['product'], required: true, help: 'Unique product SKU — matches an existing product to update, else creates' },
  { key: 'name', header: 'name', coerce: 'text', rowTypes: ['product'], required: true },
  { key: 'slug', header: 'slug', coerce: 'text', rowTypes: ['product'], help: 'Optional — kept/derived if blank' },
  { key: 'category', header: 'category', coerce: 'text', rowTypes: ['product'], help: 'Existing category name (resolved to id)' },
  { key: 'brand', header: 'brand', coerce: 'text', rowTypes: ['product'], help: 'Existing brand name (resolved to id)' },
  { key: 'supplier', header: 'supplier', coerce: 'text', rowTypes: ['product'], help: 'Existing supplier name (resolved to id)' },
  { key: 'description', header: 'description', coerce: 'text', rowTypes: ['product'] },
  { key: 'short_description', header: 'short_description', coerce: 'text', rowTypes: ['product'] },
  { key: 'base_price', header: 'base_price', coerce: 'number', rowTypes: ['product'] },
  { key: 'price_ex_gst', header: 'price_ex_gst', coerce: 'number', rowTypes: ['product'] },
  { key: 'currency', header: 'currency', coerce: 'text', rowTypes: ['product'] },
  { key: 'mrp', header: 'mrp', coerce: 'number', rowTypes: ['product'] },
  { key: 'mrp_ex_gst', header: 'mrp_ex_gst', coerce: 'number', rowTypes: ['product'] },
  { key: 'gst_percentage', header: 'gst_percentage', coerce: 'number', rowTypes: ['product'], enumKey: 'gst_percentage' },
  { key: 'hsn_code', header: 'hsn_code', coerce: 'text', rowTypes: ['product'] },
  { key: 'cost_price', header: 'cost_price', coerce: 'number', rowTypes: ['product'] },
  { key: 'discount_pct', header: 'discount_pct', coerce: 'number', rowTypes: ['product'] },
  { key: 'weight', header: 'weight', coerce: 'number', rowTypes: ['product'] },
  { key: 'dimensions', header: 'dimensions', coerce: 'text', rowTypes: ['product'] },
  { key: 'material', header: 'material', coerce: 'text', rowTypes: ['product'] },
  { key: 'finish', header: 'finish', coerce: 'text', rowTypes: ['product'] },
  { key: 'size', header: 'size', coerce: 'text', rowTypes: ['product'] },
  { key: 'color', header: 'color', coerce: 'text', rowTypes: ['product'] },
  { key: 'color_hex', header: 'color_hex', coerce: 'text', rowTypes: ['product'] },
  { key: 'is_featured', header: 'is_featured', coerce: 'bool', rowTypes: ['product'] },
  { key: 'has_variants', header: 'has_variants', coerce: 'bool', rowTypes: ['product'], help: 'true when the product has variant rows below it' },
  { key: 'variant_type', header: 'variant_type', coerce: 'text', rowTypes: ['product'] },
  { key: 'sub_variant_type', header: 'sub_variant_type', coerce: 'text', rowTypes: ['product'] },
  { key: 'mpn', header: 'mpn', coerce: 'text', rowTypes: ['product'] },
  { key: 'gtin', header: 'gtin', coerce: 'text', rowTypes: ['product'] },
  { key: 'barcode', header: 'barcode', coerce: 'text', rowTypes: ['product'] },
  { key: 'isbn', header: 'isbn', coerce: 'text', rowTypes: ['product'] },
  { key: 'asin', header: 'asin', coerce: 'text', rowTypes: ['product'] },
  { key: 'brand_part_number', header: 'brand_part_number', coerce: 'text', rowTypes: ['product'] },
  { key: 'weight_grams', header: 'weight_grams', coerce: 'int', rowTypes: ['product'] },
  { key: 'net_weight_grams', header: 'net_weight_grams', coerce: 'int', rowTypes: ['product'] },
  { key: 'volume_ml', header: 'volume_ml', coerce: 'number', rowTypes: ['product'] },
  { key: 'length_cm', header: 'length_cm', coerce: 'number', rowTypes: ['product'] },
  { key: 'breadth_cm', header: 'breadth_cm', coerce: 'number', rowTypes: ['product'] },
  { key: 'height_cm', header: 'height_cm', coerce: 'number', rowTypes: ['product'] },
  { key: 'package_type', header: 'package_type', coerce: 'text', rowTypes: ['product'], enumKey: 'package_type' },
  { key: 'country_of_origin', header: 'country_of_origin', coerce: 'text', rowTypes: ['product'] },
  { key: 'inventory_quantity', header: 'inventory_quantity', coerce: 'number', rowTypes: ['product'], help: 'Ignored for variant products (rolled up from children)' },
  { key: 'inventory_sync', header: 'inventory_sync', coerce: 'bool', rowTypes: ['product'] },
  { key: 'low_stock_threshold', header: 'low_stock_threshold', coerce: 'number', rowTypes: ['product'] },
  { key: 'stock_status', header: 'stock_status', coerce: 'text', rowTypes: ['product'], enumKey: 'stock_status' },
  { key: 'extra_delivery_days', header: 'extra_delivery_days', coerce: 'int', rowTypes: ['product'] },
  { key: 'handling_days', header: 'handling_days', coerce: 'int', rowTypes: ['product'] },
  { key: 'shipping_class', header: 'shipping_class', coerce: 'text', rowTypes: ['product'], enumKey: 'shipping_class' },
  { key: 'is_oversized', header: 'is_oversized', coerce: 'bool', rowTypes: ['product'] },
  { key: 'volumetric_weight_grams', header: 'volumetric_weight_grams', coerce: 'int', rowTypes: ['product'] },
  { key: 'fragile', header: 'fragile', coerce: 'bool', rowTypes: ['product'] },
  { key: 'hazardous', header: 'hazardous', coerce: 'bool', rowTypes: ['product'] },
  { key: 'flammable', header: 'flammable', coerce: 'bool', rowTypes: ['product'] },
  { key: 'perishable', header: 'perishable', coerce: 'bool', rowTypes: ['product'] },
  { key: 'shelf_life_days', header: 'shelf_life_days', coerce: 'int', rowTypes: ['product'] },
  { key: 'serialized', header: 'serialized', coerce: 'bool', rowTypes: ['product'] },
  { key: 'certifications', header: 'certifications', coerce: 'csv', rowTypes: ['product'] },
  { key: 'compliance_standard', header: 'compliance_standard', coerce: 'text', rowTypes: ['product'] },
  { key: 'safety_rating', header: 'safety_rating', coerce: 'text', rowTypes: ['product'] },
  { key: 'warranty_months', header: 'warranty_months', coerce: 'int', rowTypes: ['product'] },
  { key: 'warranty_type', header: 'warranty_type', coerce: 'text', rowTypes: ['product'], enumKey: 'warranty_type' },
  { key: 'condition', header: 'condition', coerce: 'text', rowTypes: ['product'], enumKey: 'condition' },
  { key: 'grade', header: 'grade', coerce: 'text', rowTypes: ['product'] },
  { key: 'is_cod_allowed', header: 'is_cod_allowed', coerce: 'bool', rowTypes: ['product'] },
  { key: 'launch_date', header: 'launch_date', coerce: 'date', rowTypes: ['product'] },
  { key: 'discontinue_date', header: 'discontinue_date', coerce: 'date', rowTypes: ['product'] },
  { key: 'sort_order', header: 'sort_order', coerce: 'int', rowTypes: ['product'] },
  { key: 'is_digital', header: 'is_digital', coerce: 'bool', rowTypes: ['product'] },
  { key: 'download_url', header: 'download_url', coerce: 'text', rowTypes: ['product'] },
  { key: 'license_type', header: 'license_type', coerce: 'text', rowTypes: ['product'] },
  { key: 'file_format', header: 'file_format', coerce: 'text', rowTypes: ['product'] },
  { key: 'platform_compatibility', header: 'platform_compatibility', coerce: 'csv', rowTypes: ['product'] },
  { key: 'is_subscription', header: 'is_subscription', coerce: 'bool', rowTypes: ['product'] },
  { key: 'subscription_interval', header: 'subscription_interval', coerce: 'text', rowTypes: ['product'], enumKey: 'subscription_interval' },
  { key: 'subscription_price', header: 'subscription_price', coerce: 'number', rowTypes: ['product'] },
  { key: 'is_bundle', header: 'is_bundle', coerce: 'bool', rowTypes: ['product'] },
  { key: 'meta_title', header: 'meta_title', coerce: 'text', rowTypes: ['product'] },
  { key: 'meta_description', header: 'meta_description', coerce: 'text', rowTypes: ['product'] },
  { key: 'meta_keywords', header: 'meta_keywords', coerce: 'csv', rowTypes: ['product'] },
  { key: 'is_searchable', header: 'is_searchable', coerce: 'bool', rowTypes: ['product'] },
  { key: 'tax_class', header: 'tax_class', coerce: 'text', rowTypes: ['product'], enumKey: 'tax_class' },
  { key: 'inclusive_tax', header: 'inclusive_tax', coerce: 'bool', rowTypes: ['product'] },
  { key: 'age_min', header: 'age_min', coerce: 'int', rowTypes: ['product'] },
  { key: 'age_max', header: 'age_max', coerce: 'int', rowTypes: ['product'] },
  { key: 'target_gender', header: 'target_gender', coerce: 'text', rowTypes: ['product'], enumKey: 'target_gender' },
  { key: 'target_audience', header: 'target_audience', coerce: 'csv', rowTypes: ['product'] },
]

// Variant columns — the product_variants INSERT list in the publish path.
export const VARIANT_COLUMNS: ImportColumn[] = [
  { key: 'sku', header: 'variant.sku', coerce: 'text', rowTypes: ['variant'], required: true },
  { key: 'variant_name', header: 'variant.variant_name', coerce: 'text', rowTypes: ['variant'], required: true },
  { key: 'price', header: 'variant.price', coerce: 'number', rowTypes: ['variant'] },
  { key: 'mrp', header: 'variant.mrp', coerce: 'number', rowTypes: ['variant'] },
  { key: 'price_ex_gst', header: 'variant.price_ex_gst', coerce: 'number', rowTypes: ['variant'] },
  { key: 'mrp_ex_gst', header: 'variant.mrp_ex_gst', coerce: 'number', rowTypes: ['variant'] },
  { key: 'inventory_quantity', header: 'variant.inventory_quantity', coerce: 'number', rowTypes: ['variant'] },
  { key: 'stock_status', header: 'variant.stock_status', coerce: 'text', rowTypes: ['variant'], enumKey: 'stock_status' },
  { key: 'mpn', header: 'variant.mpn', coerce: 'text', rowTypes: ['variant'] },
  { key: 'gtin', header: 'variant.gtin', coerce: 'text', rowTypes: ['variant'] },
  { key: 'asin', header: 'variant.asin', coerce: 'text', rowTypes: ['variant'] },
  { key: 'isbn', header: 'variant.isbn', coerce: 'text', rowTypes: ['variant'] },
  { key: 'unit', header: 'variant.unit', coerce: 'text', rowTypes: ['variant'], enumKey: 'unit' },
  { key: 'numeric_value', header: 'variant.numeric_value', coerce: 'number', rowTypes: ['variant'] },
  { key: 'weight_grams', header: 'variant.weight_grams', coerce: 'int', rowTypes: ['variant'] },
  { key: 'package_type', header: 'variant.package_type', coerce: 'text', rowTypes: ['variant'], enumKey: 'package_type' },
  { key: 'length_cm', header: 'variant.length_cm', coerce: 'number', rowTypes: ['variant'] },
  { key: 'breadth_cm', header: 'variant.breadth_cm', coerce: 'number', rowTypes: ['variant'] },
  { key: 'height_cm', header: 'variant.height_cm', coerce: 'number', rowTypes: ['variant'] },
  { key: 'cost_price', header: 'variant.cost_price', coerce: 'number', rowTypes: ['variant'] },
  { key: 'sub_variant_type_on', header: 'variant.sub_variant_type_on', coerce: 'bool', rowTypes: ['variant'], help: 'true when this variant has sub-variant rows' },
]

// Sub-variant columns — the product_sub_variants INSERT list in the publish path.
export const SUB_VARIANT_COLUMNS: ImportColumn[] = [
  { key: 'sku', header: 'sub_variant.sku', coerce: 'text', rowTypes: ['sub_variant'] },
  { key: 'sub_variant_name', header: 'sub_variant.sub_variant_name', coerce: 'text', rowTypes: ['sub_variant'], required: true },
  { key: 'price', header: 'sub_variant.price', coerce: 'number', rowTypes: ['sub_variant'] },
  { key: 'mrp', header: 'sub_variant.mrp', coerce: 'number', rowTypes: ['sub_variant'] },
  { key: 'price_ex_gst', header: 'sub_variant.price_ex_gst', coerce: 'number', rowTypes: ['sub_variant'] },
  { key: 'mrp_ex_gst', header: 'sub_variant.mrp_ex_gst', coerce: 'number', rowTypes: ['sub_variant'] },
  { key: 'stock_status', header: 'sub_variant.stock_status', coerce: 'text', rowTypes: ['sub_variant'], enumKey: 'stock_status' },
]

// Every column, in template order. Header labels are unique across the whole set,
// so a parsed row maps unambiguously back to (section, key).
export const ALL_COLUMNS: ImportColumn[] = [
  ...STRUCTURE_COLUMNS,
  ...PRODUCT_COLUMNS,
  ...VARIANT_COLUMNS,
  ...SUB_VARIANT_COLUMNS,
]

export const HEADER_ROW: string[] = ALL_COLUMNS.map(c => c.header)

export function columnByHeader(header: string): ImportColumn | undefined {
  return ALL_COLUMNS.find(c => c.header === header)
}
