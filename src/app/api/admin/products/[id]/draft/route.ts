import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const product = await queryOne<{ id: string; name: string; sku: string }>(
      `SELECT id, name, sku FROM products WHERE id = $1 AND is_active = true`,
      [id]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found or not a live product' }, { status: 404 })
    }

    const existingDraft = await queryOne<{ product_id: string }>(
      `SELECT product_id FROM product_drafts WHERE product_id = $1`,
      [id]
    )
    if (existingDraft) {
      return NextResponse.json(
        { error: 'A draft already exists for this product', productId: existingDraft.product_id },
        { status: 409 }
      )
    }

    await query(
      `INSERT INTO product_drafts (product_id, fields, variants, images, sub_variants, units)
       SELECT
         p.id,
         to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'search_vector' - 'views_count' - 'sales_count',
         COALESCE((SELECT json_agg(to_jsonb(v) - 'id') FROM product_variants v WHERE v.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(i) - 'id' ORDER BY i.display_order) FROM product_images i WHERE i.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(sv) - 'id') FROM product_sub_variants sv WHERE sv.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(u) - 'id') FROM product_units u WHERE u.product_id = p.id), '[]')
       FROM products p WHERE p.id = $1`,
      [id]
    )

    return NextResponse.json({ success: true, productId: id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to create draft' }, { status: 500 })
  }
}

// Autosave: update only the fields column of an existing draft
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const fields = body?.fields
    if (!fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const draft = await queryOne<{ product_id: string }>(
      `SELECT product_id FROM product_drafts WHERE product_id = $1`,
      [id]
    )
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

    // Build image snapshot: take live product_images, apply order/primary from client state
    const imageOrder: string[] = body?.imageOrder || []
    const existingImagesToKeep: { id: string; is_primary?: boolean }[] = body?.existingImagesToKeep || []
    const keepIds = new Set(existingImagesToKeep.map((img: any) => img.id))

    // Re-snapshot images from DB filtered to kept IDs, then apply order and primary from client
    const imagesSnapshotSql = keepIds.size > 0
      ? `SELECT to_jsonb(i) - 'id' || jsonb_build_object(
           'display_order', idx.ord,
           'is_primary', idx.is_primary
         ) AS img
         FROM product_images i
         JOIN (
           SELECT id, ordinality - 1 AS ord,
                  id = $3 AS is_primary
           FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ordinality)
         ) idx ON idx.id = i.id
         WHERE i.product_id = $1`
      : null

    // Determine ordered IDs and primary from imageOrder
    const orderedExistingIds = imageOrder
      .filter((k: string) => k.startsWith('existing:'))
      .map((k: string) => k.slice(9))
      .filter((id: string) => keepIds.has(id))

    const primaryKey = imageOrder[0] || ''
    const primaryId = primaryKey.startsWith('existing:') ? primaryKey.slice(9) : null

    let imagesJson = '[]'
    if (orderedExistingIds.length > 0) {
      const rows = await query<{ img: Record<string, unknown> }>(
        `SELECT to_jsonb(i) - 'id' AS img, array_position($2::uuid[], i.id) - 1 AS ord,
                i.id = $3 AS is_primary
         FROM product_images i
         WHERE i.product_id = $1 AND i.id = ANY($2::uuid[])
         ORDER BY array_position($2::uuid[], i.id)`,
        [id, orderedExistingIds, primaryId]
      )
      imagesJson = JSON.stringify(rows.rows.map((r: any) => ({
        ...r.img,
        display_order: r.ord,
        is_primary: r.is_primary,
      })))
    } else {
      // Fall back to current live images
      const rows = await query(
        `SELECT json_agg(to_jsonb(i) - 'id' ORDER BY i.display_order) FROM product_images i WHERE i.product_id = $1`,
        [id]
      )
      imagesJson = JSON.stringify(rows.rows[0]?.json_agg || [])
    }

    await query(
      `UPDATE product_drafts SET fields = $2::jsonb, images = $3::jsonb, updated_at = NOW() WHERE product_id = $1`,
      [id, JSON.stringify(fields), imagesJson]
    )

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Autosave failed' }, { status: 500 })
  }
}

// DELETE — discard the draft entirely
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    await query(`DELETE FROM product_drafts WHERE product_id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to discard draft' }, { status: 500 })
  }
}
