import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

// GET /api/admin/products/[id]/offers — the offers this product belongs to.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const product = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [id])
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const offers = await queryMany(
    `SELECT o.id, o.slug, o.title
       FROM product_offer_items i
       JOIN product_offers o ON o.id = i.offer_id
      WHERE i.product_id = $1
      ORDER BY o.display_order ASC, o.created_at ASC`,
    [id]
  )
  return NextResponse.json({ offers })
}

const putSchema = z.object({ offerIds: z.array(zUuid) })

// PUT /api/admin/products/[id]/offers — replace the offers this product is in.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const product = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [id])
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const parsed = parseBody(putSchema, await request.json())
  if (!parsed.ok) return parsed.response
  const offerIds = Array.from(new Set(parsed.data.offerIds))

  await withTransaction(async client => {
    await client.query(`DELETE FROM product_offer_items WHERE product_id = $1`, [id])
    if (offerIds.length > 0) {
      await client.query(
        `INSERT INTO product_offer_items (offer_id, product_id)
           SELECT oid, $1 FROM unnest($2::uuid[]) AS oid
         ON CONFLICT DO NOTHING`,
        [id, offerIds]
      )
    }
  })

  return NextResponse.json({ success: true, count: offerIds.length })
}
