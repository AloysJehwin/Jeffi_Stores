import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/shared/validate'
import { findOpenSession } from '@/lib/admin/editor-sessions'
import { ensureOfferDraft } from '@/lib/admin/offer-drafts'

export const dynamic = 'force-dynamic'

async function draftProductIds(offerId: string): Promise<string[] | null> {
  const row = await queryOne<{ products: string[] | null }>(
    `SELECT products FROM offer_drafts WHERE offer_id = $1`,
    [offerId]
  )
  return (row?.products ?? null) as string[] | null
}

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
      [`%${q}%`]
    )
    return NextResponse.json({ items: rows.map(r => ({ id: r.id, label: r.name, sublabel: r.sku })) })
  }

  const session = await findOpenSession(admin.adminId, 'offer', id)
  if (session) {
    await ensureOfferDraft(id)
    const ids = (await draftProductIds(id)) ?? []
    if (ids.length === 0) return NextResponse.json({ products: [] })
    const products = await queryMany(
      `SELECT p.id, p.name, p.sku, p.image_url
         FROM products p WHERE p.id = ANY($1::uuid[])
         ORDER BY p.name ASC`,
      [ids]
    )
    return NextResponse.json({ products })
  }

  const products = await queryMany(
    `SELECT p.id, p.name, p.sku, p.image_url
       FROM product_offer_items i
       JOIN products p ON p.id = i.product_id
      WHERE i.offer_id = $1
      ORDER BY p.name ASC`,
    [id]
  )
  return NextResponse.json({ products })
}

const putSchema = z.object({ productIds: z.array(zUuid) })

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

  const session = await findOpenSession(admin.adminId, 'offer', id)
  if (session) {
    await ensureOfferDraft(id)
    await query(
      `UPDATE offer_drafts SET products = $1::jsonb, updated_at = now() WHERE offer_id = $2`,
      [JSON.stringify(productIds), id]
    )
    return NextResponse.json({ success: true, count: productIds.length, draft: true })
  }

  await withTransaction(async client => {
    await client.query(`DELETE FROM product_offer_items WHERE offer_id = $1`, [id])
    if (productIds.length > 0) {
      await client.query(
        `INSERT INTO product_offer_items (offer_id, product_id)
           SELECT $1, pid FROM unnest($2::uuid[]) AS pid
         ON CONFLICT DO NOTHING`,
        [id, productIds]
      )
    }
  })
  return NextResponse.json({ success: true, count: productIds.length })
}

const bulkSchema = z
  .object({
    action: z.enum(['add', 'remove']),
    categoryId: z.guid().optional(),
    brandId: z.guid().optional(),
  })
  .refine(b => Boolean(b.categoryId) !== Boolean(b.brandId), {
    message: 'Provide exactly one of categoryId or brandId',
  })

const CATEGORY_TREE = `WITH RECURSIVE tree AS (
    SELECT id FROM categories WHERE id = $1
    UNION
    SELECT c.id FROM categories c JOIN tree t ON c.parent_category_id = t.id WHERE c.is_active = true
  )`

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

  // Resolve the match set to product ids first — one SQL path, reused for both draft & live.
  const matchIdsSql = categoryId
    ? `${CATEGORY_TREE} SELECT p.id FROM products p WHERE p.is_active = true AND p.category_id IN (SELECT id FROM tree)`
    : `SELECT p.id FROM products p WHERE p.is_active = true AND p.brand_id = $1`
  const matched = await queryMany<{ id: string }>(matchIdsSql, [categoryId ?? brandId])
  const matchedIds = matched.map(m => m.id)

  const session = await findOpenSession(admin.adminId, 'offer', id)
  if (session) {
    await ensureOfferDraft(id)
    const current = (await draftProductIds(id)) ?? []
    const next =
      action === 'add'
        ? Array.from(new Set([...current, ...matchedIds]))
        : current.filter(pid => !matchedIds.includes(pid))
    const changed = Math.abs(next.length - current.length)
    await query(
      `UPDATE offer_drafts SET products = $1::jsonb, updated_at = now() WHERE offer_id = $2`,
      [JSON.stringify(next), id]
    )
    return NextResponse.json({ changed, total: next.length, draft: true })
  }

  await withTransaction(async client => {
    if (action === 'add') {
      await client.query(
        `INSERT INTO product_offer_items (offer_id, product_id)
           SELECT $1, pid FROM unnest($2::uuid[]) AS pid
         ON CONFLICT DO NOTHING`,
        [id, matchedIds]
      )
    } else {
      await client.query(
        `DELETE FROM product_offer_items WHERE offer_id = $1 AND product_id = ANY($2::uuid[])`,
        [id, matchedIds]
      )
    }
  })
  const total = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM product_offer_items WHERE offer_id = $1`,
    [id]
  )
  return NextResponse.json({ changed: matchedIds.length, total: total?.n ?? 0 })
}

