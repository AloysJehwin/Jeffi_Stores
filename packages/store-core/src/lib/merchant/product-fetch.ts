import { queryMany, queryOne } from '@/lib/shared/db'

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
    ) AS product_variants,
    -- Product-level gallery from product_media (primary first); feeds prefer it over product_images.
    COALESCE(
      (SELECT json_agg(m.url ORDER BY m.is_primary DESC, m.sort_order)
       FROM product_media m
       WHERE m.root_product_id = p.id AND m.variant_id IS NULL AND m.sub_variant_id IS NULL
         AND m.kind = 'image' AND m.status = 'ready'),
      '[]'::json
    ) AS media_image_urls
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN categories pc ON c.parent_category_id = pc.id
  LEFT JOIN brands b ON p.brand_id = b.id
`

export async function fetchAllActiveProducts() {
  return queryMany(`${PRODUCT_SELECT} ORDER BY p.created_at DESC`)
}

/** Products for a push, limited to some brands and/or categories (a category includes its sub-categories). */
export async function fetchProductsForPush(scope?: { brandIds?: string[]; categoryIds?: string[] } | null) {
  const brandIds = scope?.brandIds?.length ? scope.brandIds : null
  const categoryIds = scope?.categoryIds?.length ? scope.categoryIds : null
  if (!brandIds && !categoryIds) return fetchAllActiveProducts()
  return queryMany(
    `${PRODUCT_SELECT}
     WHERE ($1::uuid[] IS NULL OR p.brand_id = ANY($1::uuid[]))
       AND ($2::uuid[] IS NULL OR p.category_id IN (
         WITH RECURSIVE d AS (SELECT id FROM categories WHERE id = ANY($2::uuid[])
                              UNION SELECT k.id FROM categories k JOIN d ON k.parent_category_id = d.id)
         SELECT id FROM d))
     ORDER BY p.created_at DESC`,
    [brandIds, categoryIds]
  )
}

export async function fetchProduct(productId: string) {
  return queryOne(`${PRODUCT_SELECT} WHERE p.id = $1`, [productId])
}
