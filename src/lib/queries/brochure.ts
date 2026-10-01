import { queryMany } from './shared'

export interface BrochureProduct {
  id: string
  name: string
  slug: string
  sku: string
  short_description: string | null
  mrp: number | null
  base_price: number | null
  discount_pct: number | null
  brand_name: string | null
  category_name: string | null
  thumbnail_url: string | null
}

// Shared lean projection for every brochure query. Primary image (fallback:
// first by display_order) is joined for the thumbnail. Only active products.
// Effective price/mrp: use the product's own base_price/mrp when > 0, else fall
// back to the lowest active variant / sub-variant price (variant products carry
// base_price = 0, with the real price on the variants — same rule the admin
// product list uses for its "From Rs." display).
const BROCHURE_SELECT = `
  SELECT
    p.id, p.name, p.slug, p.sku, p.short_description, p.discount_pct,
    COALESCE(
      NULLIF(p.base_price, 0),
      (SELECT MIN(px) FROM (
        SELECT NULLIF(pv.price, 0) AS px FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        UNION ALL
        SELECT NULLIF(sv.price, 0) AS px FROM product_sub_variants sv
          WHERE sv.product_id = p.id AND sv.is_active = true
      ) q WHERE px IS NOT NULL)
    ) AS base_price,
    COALESCE(
      NULLIF(p.mrp, 0),
      (SELECT MIN(mx) FROM (
        SELECT NULLIF(pv.mrp, 0) AS mx FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        UNION ALL
        SELECT NULLIF(sv.mrp, 0) AS mx FROM product_sub_variants sv
          WHERE sv.product_id = p.id AND sv.is_active = true
      ) q WHERE mx IS NOT NULL)
    ) AS mrp,
    b.name AS brand_name,
    c.name AS category_name,
    (
      SELECT COALESCE(pi.thumbnail_url, pi.image_url)
      FROM product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order ASC
      LIMIT 1
    ) AS thumbnail_url
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
`

/**
 * Products under the selected category subtrees (a parent auto-includes its
 * sub-categories via the recursive cat_tree) — regardless of brand. Backs the
 * categories-page brochure. Active products only.
 */
export async function getBrochureProductsByCategories(categoryIds: string[]): Promise<BrochureProduct[]> {
  if (categoryIds.length === 0) return []
  return queryMany<BrochureProduct>(
    `
    WITH RECURSIVE cat_tree AS (
      SELECT id FROM categories WHERE id = ANY($1::uuid[])
      UNION ALL
      SELECT c.id FROM categories c JOIN cat_tree ct ON c.parent_category_id = ct.id
    )
    ${BROCHURE_SELECT}
    WHERE p.is_active = true
      AND p.category_id IN (SELECT id FROM cat_tree)
    ORDER BY c.name ASC, p.name ASC
    `,
    [categoryIds]
  )
}

/**
 * Products for the selected brands — regardless of category. Backs the
 * brands-page brochure. Active products only.
 */
export async function getBrochureProductsByBrands(brandIds: string[]): Promise<BrochureProduct[]> {
  if (brandIds.length === 0) return []
  return queryMany<BrochureProduct>(
    `
    ${BROCHURE_SELECT}
    WHERE p.is_active = true
      AND p.brand_id = ANY($1::uuid[])
    ORDER BY b.name ASC, p.name ASC
    `,
    [brandIds]
  )
}

/**
 * Products by explicit id list — the final admin selection (after deselecting in
 * the popup). Returned in the given id order so the PDF matches the preview.
 */
export async function getBrochureProductsByIds(productIds: string[]): Promise<BrochureProduct[]> {
  if (productIds.length === 0) return []
  const rows = await queryMany<BrochureProduct>(
    `
    ${BROCHURE_SELECT}
    WHERE p.is_active = true
      AND p.id = ANY($1::uuid[])
    `,
    [productIds]
  )
  const byId = new Map(rows.map(r => [r.id, r]))
  return productIds.map(id => byId.get(id)).filter(Boolean) as BrochureProduct[]
}
