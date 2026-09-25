import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne, withTransaction } from '@/lib/db'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'

export const dynamic = 'force-dynamic'

// GET /api/admin/product-offers/[id]/products — assigned products, or (with ?q=) candidate
// products to assign. Both return plain product rows so ids are real product uuids the PUT accepts.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const q = (request.nextUrl.searchParams.get('q') || '').trim()
  if (q) {
    const rows = await queryMany<{ id: string; name: string; sku: string | null }>(
      `SELECT id, name, sku FROM products
        WHERE is_active = true AND (name ILIKE $1 OR sku ILIKE $1)
        ORDER BY name ASC LIMIT 10`,
      [`%${q}%`],
    )
    return NextResponse.json({ items: rows.map(r => ({ id: r.id, label: r.name, sublabel: r.sku })) })
  }

  const products = await queryMany(
    `SELECT p.id, p.name, p.sku, p.image_url
       FROM product_offer_items i
       JOIN products p ON p.id = i.product_id
      WHERE i.offer_id = $1
      ORDER BY p.name ASC`,
    [id],
  )
  return NextResponse.json({ products })
}

const putSchema = z.object({ productIds: z.array(zUuid) })

// PUT /api/admin/product-offers/[id]/products — replace the full membership.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const parsed = parseBody(putSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const productIds = Array.from(new Set(parsed.data.productIds))

  await withTransaction(async client => {
    await client.query(`DELETE FROM product_offer_items WHERE offer_id = $1`, [id])
    if (productIds.length > 0) {
      await client.query(
        `INSERT INTO product_offer_items (offer_id, product_id)
           SELECT $1, pid FROM unnest($2::uuid[]) AS pid
         ON CONFLICT DO NOTHING`,
        [id, productIds],
      )
    }
  })

  return NextResponse.json({ success: true, count: productIds.length })
}

// Brand ids include seeded non-RFC uuids, so these accept any Postgres uuid shape.
const bulkSchema = z.object({
  action: z.enum(['add', 'remove']),
  categoryId: z.guid().optional(),
  brandId: z.guid().optional(),
}).refine(b => Boolean(b.categoryId) !== Boolean(b.brandId), {
  message: 'Provide exactly one of categoryId or brandId',
})

const CATEGORY_TREE = `WITH RECURSIVE tree AS (
    SELECT id FROM categories WHERE id = $2
    UNION
    SELECT c.id FROM categories c JOIN tree t ON c.parent_category_id = t.id WHERE c.is_active = true
  )`

// POST /api/admin/product-offers/[id]/products — add or remove every product in a category
// (subcategories included) or a brand. Adding skips inactive products and existing members.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const offer = await queryOne<{ id: string }>(`SELECT id FROM product_offers WHERE id = $1`, [id])
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const parsed = parseBody(bulkSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const { action, categoryId, brandId } = parsed.data

  const tree = categoryId ? CATEGORY_TREE : ''
  const match = categoryId ? 'p.category_id IN (SELECT id FROM tree)' : 'p.brand_id = $2'
  const sql = action === 'add'
    ? `${tree} INSERT INTO product_offer_items (offer_id, product_id)
         SELECT $1, p.id FROM products p WHERE p.is_active = true AND ${match}
       ON CONFLICT DO NOTHING`
    : `${tree} DELETE FROM product_offer_items i USING products p
        WHERE i.offer_id = $1 AND i.product_id = p.id AND ${match}`

  const result = await query(sql, [id, categoryId ?? brandId])
  const total = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM product_offer_items WHERE offer_id = $1`,
    [id],
  )
  return NextResponse.json({ changed: result.rowCount ?? 0, total: total?.n ?? 0 })
}
