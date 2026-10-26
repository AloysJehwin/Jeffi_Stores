import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { deleteProductImage } from '@/lib/shared/s3'
import { productErrorMessage, roundMoneyFields } from '@/lib/catalog/product-validation'
import { normalizeSubscriptionPrice, normalizeSubscriptionPrices } from '@/lib/subscriptions/sellable'
import { applyDraftSubVariantPrices, parseSubVariantPriceEntries } from '@/lib/subscriptions/sub-variant-prices'
import {
  acquireDraftLock,
  actorOf,
  closeAfter,
  discardGuard,
  draftLockResponse,
  epochFrom,
  withDraftCreate,
  withDraftWrite,
} from '@/lib/admin/draft-locks'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

// A session's snapshot belongs to the draft it was opened on; a new or discarded draft ends it.
async function closeProductSessions(productId: string) {
  try {
    await query(
      `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'save'
        WHERE resource_type = 'product' AND resource_id = $1 AND closed_at IS NULL`,
      [productId]
    )
  } catch (e) {
    console.error('[product-draft] closing edit sessions failed for', productId, e)
  }
}

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
    const actor = actorOf(admin)
    if (existingDraft) {
      // 409 = the draft is (now) yours, go edit; 423 = someone else holds it.
      await acquireDraftLock(actor, 'product', id)
      return NextResponse.json(
        { error: 'A draft already exists for this product', productId: existingDraft.product_id },
        { status: 409 }
      )
    }

    await withDraftCreate(actor, 'product', id, db =>
      db.query(
        `INSERT INTO product_drafts (product_id, fields, variants, images, sub_variants, units, variant_images)
       SELECT
         p.id,
         to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'search_vector' - 'views_count' - 'sales_count' - 'inventory_quantity',
         COALESCE((SELECT json_agg(to_jsonb(v) || jsonb_build_object('sub_variant_type_on',
                     v.sub_variant_type_on OR EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.variant_id = v.id AND sv.is_active = true)))
                   FROM product_variants v WHERE v.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(i) ORDER BY i.display_order) FROM product_images i WHERE i.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(sv) ORDER BY sv.created_at, sv.sub_variant_name)
                   FROM product_sub_variants sv
                   JOIN product_variants v ON v.id = sv.variant_id
                   WHERE v.product_id = p.id AND sv.is_active = true), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(u) - 'id') FROM product_units u WHERE u.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(vi) ORDER BY vi.display_order)
                   FROM variant_images vi
                   JOIN product_variants v ON v.id = vi.variant_id
                   WHERE v.product_id = p.id), '[]')
       FROM products p WHERE p.id = $1`,
        [id]
      )
    )
    await closeProductSessions(id)

    return NextResponse.json({ success: true, productId: id })
  } catch (err: unknown) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    console.error('[product-draft] create failed for', id, err)
    return NextResponse.json({ error: productErrorMessage(err, 'Failed to create draft') }, { status: 500 })
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
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
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
        imagesJson = JSON.stringify(
          rows.rows.map((r: any) => ({
            ...r.img,
            display_order: r.ord,
            is_primary: r.is_primary,
          }))
        )
      } else {
        // Intent present but no existing images kept (all removed) → empty set.
        imagesJson = '[]'
      }
    }

    const variantsFromBody = body?.variants
    const variantsJson = Array.isArray(variantsFromBody)
      ? JSON.stringify(
          variantsFromBody.map((v: any) => ({
            ...roundMoneyFields(v),
            subscription_price: normalizeSubscriptionPrice(v?.subscription_price),
            subscription_prices: normalizeSubscriptionPrices(v?.subscription_prices),
          }))
        )
      : null

    await withDraftWrite(
      actorOf(admin),
      'product',
      id,
      db =>
        db.query(
          `UPDATE product_drafts SET fields = $2::jsonb,
           images = COALESCE($3::jsonb, images),
           variants = COALESCE($4::jsonb, variants),
           updated_at = NOW() WHERE product_id = $1`,
          [id, JSON.stringify(roundMoneyFields(fields)), imagesJson, variantsJson]
        ),
      { epoch: epochFrom(req) }
    )
    await applyDraftSubVariantPrices(id, parseSubVariantPriceEntries(body?.subVariantSubscriptionPrices))

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const locked = draftLockResponse(err)
    if (locked) return locked
    console.error('[product-draft] autosave failed for', id, err)
    return NextResponse.json({ error: productErrorMessage(err, 'Autosave failed') }, { status: 500 })
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
  const actor = actorOf(admin)
  const denied = await discardGuard(actor, 'product', id)
  if (denied) return denied
  try {
    // Clean up S3 files for variant images that were uploaded fresh into this draft
    // (staged, never applied to live). Live-image rows (real uuid ids) are left alone —
    // their files still back the live product.
    const draft = await queryOne<{ variant_images: any[]; images: any[] }>(
      `SELECT variant_images, images FROM product_drafts WHERE product_id = $1`,
      [id]
    )

    // Create-draft (is_draft=true, no product_drafts edit-draft): discarding means deleting the
    // product row itself, since it was never published to the live list.
    if (!draft) {
      const createDraft = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1 AND is_draft = true`, [
        id,
      ])
      if (createDraft) {
        await query(`DELETE FROM products WHERE id = $1 AND is_draft = true`, [id])
        await closeAfter(actor, 'product', id, 'discarded')
        return NextResponse.json({ success: true })
      }
    }

    const stagedVI = Array.isArray(draft?.variant_images) ? draft!.variant_images : []
    for (const vi of stagedVI) {
      if (vi?._staged && vi?.s3_key && String(vi.id).startsWith('draft-vi-')) {
        await deleteProductImage(vi.s3_key, vi.s3_thumbnail_key || '').catch(e =>
          console.error('[product-draft] staged variant image cleanup failed for', id, vi.s3_key, e)
        )
      }
    }
    const stagedImages = Array.isArray(draft?.images) ? draft!.images : []
    for (const img of stagedImages) {
      if (img?._staged && img?.s3_key && String(img.id).startsWith('draft-img-')) {
        await deleteProductImage(img.s3_key, img.s3_thumbnail_key || '').catch(e =>
          console.error('[product-draft] staged image cleanup failed for', id, img.s3_key, e)
        )
      }
    }
    await query(`DELETE FROM product_drafts WHERE product_id = $1`, [id])
    await closeProductSessions(id)
    await closeAfter(actor, 'product', id, 'discarded')
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[product-draft] discard failed for', id, err)
    return NextResponse.json({ error: productErrorMessage(err, 'Failed to discard draft') }, { status: 500 })
  }
}
