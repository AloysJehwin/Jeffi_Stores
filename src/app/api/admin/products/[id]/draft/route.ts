import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { deleteProductImage } from '@/lib/s3'

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
      `SELECT id, name, sku FROM products WHERE id = $1`,
      [id]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
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
      `INSERT INTO product_drafts (product_id, fields, variants, images, sub_variants, units, variant_images)
       SELECT
         p.id,
         to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'search_vector' - 'views_count' - 'sales_count',
         COALESCE((SELECT json_agg(to_jsonb(v)) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(i) ORDER BY i.display_order) FROM product_images i WHERE i.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(sv) || jsonb_build_object('_seeded', true))
                   FROM product_sub_variants sv
                   JOIN product_variants v ON v.id = sv.variant_id
                   WHERE v.product_id = p.id AND sv.is_active = true), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(u) - 'id') FROM product_units u WHERE u.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(vi) ORDER BY vi.display_order)
                   FROM variant_images vi
                   JOIN product_variants v ON v.id = vi.variant_id
                   WHERE v.product_id = p.id AND v.is_active = true), '[]')
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

    // "Image intent" = the client actually enumerated its image widget state. Until
    // the ImageUpload widget is touched, ProductForm sends BOTH arrays empty — a
    // field-only autosave. In that case we must NOT rewrite the draft's images column
    // (doing so would clobber the entry-seeded snapshot). Only rebuild images when the
    // client sent a real ordering or keep-set.
    const hasImageIntent = imageOrder.length > 0 || existingImagesToKeep.length > 0

    // Determine ordered IDs and primary from imageOrder
    const orderedExistingIds = imageOrder
      .filter((k: string) => k.startsWith('existing:'))
      .map((k: string) => k.slice(9))
      .filter((id: string) => keepIds.has(id))

    const primaryKey = imageOrder[0] || ''
    const primaryId = primaryKey.startsWith('existing:') ? primaryKey.slice(9) : null

    let imagesJson: string | null = null // null ⇒ preserve existing draft images
    if (hasImageIntent) {
      if (orderedExistingIds.length > 0) {
        const rows = await query<{ img: Record<string, unknown> }>(
          `SELECT to_jsonb(i) AS img, array_position($2::uuid[], i.id) - 1 AS ord,
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
        // Intent present but no existing images kept (all removed) → empty set.
        imagesJson = '[]'
      }
    }

    const variantsFromBody = body?.variants
    const variantsJson = Array.isArray(variantsFromBody) ? JSON.stringify(variantsFromBody) : null

    await query(
      `UPDATE product_drafts SET fields = $2::jsonb,
       images = COALESCE($3::jsonb, images),
       variants = COALESCE($4::jsonb, variants),
       updated_at = NOW() WHERE product_id = $1`,
      [id, JSON.stringify(fields), imagesJson, variantsJson]
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
    // Clean up S3 files for variant images that were uploaded fresh into this draft
    // (staged, never applied to live). Live-image rows (real uuid ids) are left alone —
    // their files still back the live product.
    const draft = await queryOne<{ variant_images: any[]; images: any[] }>(
      `SELECT variant_images, images FROM product_drafts WHERE product_id = $1`, [id]
    )
    const stagedVI = Array.isArray(draft?.variant_images) ? draft!.variant_images : []
    for (const vi of stagedVI) {
      if (vi?._staged && vi?.s3_key && String(vi.id).startsWith('draft-vi-')) {
        try { await deleteProductImage(vi.s3_key, vi.s3_thumbnail_key || '') } catch {}
      }
    }
    const stagedImages = Array.isArray(draft?.images) ? draft!.images : []
    for (const img of stagedImages) {
      if (img?._staged && img?.s3_key && String(img.id).startsWith('draft-img-')) {
        try { await deleteProductImage(img.s3_key, img.s3_thumbnail_key || '') } catch {}
      }
    }
    await query(`DELETE FROM product_drafts WHERE product_id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to discard draft' }, { status: 500 })
  }
}
