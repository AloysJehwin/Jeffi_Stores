import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const categoryId = searchParams.get('categoryId') || ''
  const excludeId = searchParams.get('excludeId') || ''
  const limit = Math.min(parseInt(searchParams.get('limit') || '8', 10), 20)

  if (q.length < 2) return NextResponse.json([])

  const pattern = `%${q}%`

  // Build a flat, predictable param list
  // $1 = pattern, $2 = excludeId (or repeat of pattern when no excludeId), $3 = categoryId (when present), $4 = limit
  // Simpler: always include excludeId slot; use empty string sentinel and skip via IS DISTINCT FROM

  if (categoryId) {
    // $1=pattern, $2=excludeId|null, $3=categoryId, $4=limit
    const params: any[] = [pattern, excludeId || null, categoryId, limit]
    const sql = `
      (
        SELECT p.id, p.name, p.slug, p.has_variants,
          COALESCE(pv_min.price, p.base_price) AS price,
          p.mrp,
          pi.image_url, pi.thumbnail_url,
          b.name AS brand_name,
          c.name AS category_name, c.id AS category_id,
          1 AS sort_priority
        FROM products p
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN LATERAL (
          SELECT MIN(price) AS price FROM product_variants WHERE product_id = p.id AND is_active = true
        ) pv_min ON true
        LEFT JOIN LATERAL (
          SELECT image_url, thumbnail_url FROM product_images
          WHERE product_id = p.id ORDER BY is_primary DESC, display_order LIMIT 1
        ) pi ON true
        WHERE p.is_active = true
          AND p.name ILIKE $1
          AND p.category_id = $3
          AND ($2::uuid IS NULL OR p.id != $2::uuid)
        LIMIT $4
      )
      UNION ALL
      (
        SELECT p.id, p.name, p.slug, p.has_variants,
          COALESCE(pv_min.price, p.base_price) AS price,
          p.mrp,
          pi.image_url, pi.thumbnail_url,
          b.name AS brand_name,
          c.name AS category_name, c.id AS category_id,
          2 AS sort_priority
        FROM products p
        LEFT JOIN brands b ON p.brand_id = b.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN LATERAL (
          SELECT MIN(price) AS price FROM product_variants WHERE product_id = p.id AND is_active = true
        ) pv_min ON true
        LEFT JOIN LATERAL (
          SELECT image_url, thumbnail_url FROM product_images
          WHERE product_id = p.id ORDER BY is_primary DESC, display_order LIMIT 1
        ) pi ON true
        WHERE p.is_active = true
          AND p.name ILIKE $1
          AND p.category_id != $3
          AND ($2::uuid IS NULL OR p.id != $2::uuid)
        LIMIT $4
      )
      ORDER BY sort_priority, name
      LIMIT $4
    `
    const rows = await queryMany(sql, params)
    return NextResponse.json(rows)
  }

  // $1=pattern, $2=excludeId|null, $3=limit
  const params: any[] = [pattern, excludeId || null, limit]
  const sql = `
    SELECT p.id, p.name, p.slug, p.has_variants,
      COALESCE(pv_min.price, p.base_price) AS price,
      p.mrp,
      pi.image_url, pi.thumbnail_url,
      b.name AS brand_name,
      c.name AS category_name, c.id AS category_id
    FROM products p
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN LATERAL (
      SELECT MIN(price) AS price FROM product_variants WHERE product_id = p.id AND is_active = true
    ) pv_min ON true
    LEFT JOIN LATERAL (
      SELECT image_url, thumbnail_url FROM product_images
      WHERE product_id = p.id ORDER BY is_primary DESC, display_order LIMIT 1
    ) pi ON true
    WHERE p.is_active = true
      AND p.name ILIKE $1
      AND ($2::uuid IS NULL OR p.id != $2::uuid)
    ORDER BY name
    LIMIT $3
  `
  const rows = await queryMany(sql, params)
  return NextResponse.json(rows)
}
