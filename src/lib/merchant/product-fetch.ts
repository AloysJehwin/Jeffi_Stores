import { queryMany, queryOne } from '@/lib/db'

// Shared product-join SQL used by both the Google Merchant (merchant/sync.ts) and the
// Amazon (amazon/sync.ts) feed builders, so the two never drift. Returns a product row
// with joined categories (self + parent), brand, ordered images, and active variants.
const PRODUCT_SELECT = `
  SELECT p.*,
    json_build_object(
      'id', c.id, 'name', c.name, 'slug', c.slug,
      'google_product_category', c.google_product_category,
      'parent_name', pc.name,
      'parent_google_product_category', pc.google_product_category
    ) AS categories,
    json_build_object('id', b.id, 'name', b.name) AS brands,
    COALESCE(
      (SELECT json_agg(pi ORDER BY pi.display_order)
       FROM product_images pi WHERE pi.product_id = p.id),
      '[]'::json
    ) AS product_images,
    COALESCE(
      (SELECT json_agg(pv ORDER BY pv.variant_name)
       FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
      '[]'::json
    ) AS product_variants
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN categories pc ON c.parent_category_id = pc.id
  LEFT JOIN brands b ON p.brand_id = b.id
`

export async function fetchAllActiveProducts() {
  return queryMany(`${PRODUCT_SELECT} ORDER BY p.created_at DESC`)
}

export async function fetchProduct(productId: string) {
  return queryOne(`${PRODUCT_SELECT} WHERE p.id = $1`, [productId])
}
