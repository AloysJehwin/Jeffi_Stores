import { queryMany } from '@/lib/shared/db'

// Product counts for the storefront's /brands and /categories pages; GET /api/brands?counts=1 and
// /api/categories?counts=1 serve the same rows to the app.

export interface BrandWithCount {
  id: string
  name: string
  slug: string
  description: string | null
  logo_url: string | null
  tagline: string | null
  is_featured: boolean
  product_count: string
}

/** Active brands: featured first, then display_order, then name. */
export async function listBrandsWithCounts(): Promise<BrandWithCount[]> {
  return queryMany<BrandWithCount>(`
    SELECT b.id, b.name, b.slug, b.description, b.logo_url, b.tagline, COALESCE(b.is_featured, false) AS is_featured,
      COUNT(p.id) FILTER (WHERE p.is_active = true) AS product_count
    FROM brands b
    LEFT JOIN products p ON p.brand_id = b.id
    WHERE b.is_active = true
    GROUP BY b.id
    ORDER BY COALESCE(b.is_featured, false) DESC, COALESCE(b.display_order, 0) ASC, b.name ASC
  `)
}

/** Active products per category id (own products only; the page adds the direct subcategories'). */
export async function categoryProductCounts(): Promise<Record<string, number>> {
  const rows = await queryMany<{ category_id: string; count: string }>(
    'SELECT category_id, COUNT(*) as count FROM products WHERE is_active = true GROUP BY category_id'
  )
  const counts: Record<string, number> = {}
  rows.forEach(row => {
    counts[row.category_id] = parseInt(row.count, 10)
  })
  return counts
}
