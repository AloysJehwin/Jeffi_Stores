import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import { embed, runWithHnswTuning } from '@/lib/rag'

export const dynamic = 'force-dynamic'

function vec(arr: number[]) { return '[' + arr.join(',') + ']' }

async function semanticSearch(q: string, limit: number, excludeId: string): Promise<any[]> {
  try {
    const v = await embed(q)
    const hnswResult = await runWithHnswTuning(
      `SELECT source_table, source_id, 1 - (embedding <=> $1::vector) AS sim
       FROM embeddings
       WHERE source_table IN ('products', 'product_variants')
       ORDER BY embedding <=> $1::vector LIMIT $2`,
      [vec(v), limit * 3]
    )
    const productIds: string[] = []
    const variantIds: string[] = []
    for (const r of hnswResult.rows) {
      if (r.source_table === 'products' && !productIds.includes(r.source_id)) productIds.push(r.source_id)
      else if (r.source_table === 'product_variants') variantIds.push(r.source_id)
    }
    if (variantIds.length) {
      const vp = await queryMany<{ product_id: string }>(
        `SELECT product_id::text FROM product_variants WHERE id = ANY($1::uuid[])`, [variantIds]
      )
      for (const r of vp) if (!productIds.includes(r.product_id)) productIds.push(r.product_id)
    }
    const ids = productIds.slice(0, limit)
    if (!ids.length) return []
    const rows = await queryMany(
      `SELECT p.id, p.name, p.slug, p.has_variants,
              COALESCE(pv_min.price, p.base_price) AS price,
              p.mrp,
              pi.image_url, pi.thumbnail_url,
              b.name AS brand_name,
              c.name AS category_name, c.id AS category_id
       FROM products p
       LEFT JOIN brands b ON p.brand_id = b.id
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN LATERAL (SELECT MIN(price) AS price FROM product_variants WHERE product_id = p.id AND is_active = true) pv_min ON true
       LEFT JOIN LATERAL (SELECT image_url, thumbnail_url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, display_order LIMIT 1) pi ON true
       WHERE p.is_active = true AND p.id = ANY($1::uuid[])
         AND ($2::uuid IS NULL OR p.id != $2::uuid)`,
      [ids, excludeId || null]
    )
    const order = new Map(ids.map((id, i) => [id, i]))
    return rows.sort((a: any, b: any) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
  } catch {
    return []
  }
}

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
  if (rows.length >= 3) return NextResponse.json(rows)
  // Semantic fallback when ILIKE finds too few results
  const semantic = await semanticSearch(q, limit, excludeId)
  if (!semantic.length) return NextResponse.json(rows)
  // Merge: ILIKE results first, then semantic results not already present
  const seen = new Set(rows.map((r: any) => r.id))
  const merged = [...rows, ...semantic.filter((r: any) => !seen.has(r.id))].slice(0, limit)
  return NextResponse.json(merged)
}
