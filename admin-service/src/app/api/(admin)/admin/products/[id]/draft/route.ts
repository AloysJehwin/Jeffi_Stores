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
import { productDraftIdFor, startProductDraft } from '@/lib/catalog/product-draft-id'
import { discardDraftFiles } from '@/lib/vault/files'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

// A session's snapshot belongs to the draft it was opened on; a new or discarded draft ends it.
async function closeProductSessions(draftId: string) {
  try {
    await query(
      `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'save'
        WHERE resource_type = 'product' AND resource_id = $1 AND closed_at IS NULL`,
      [draftId]
    )
  } catch (e) {
    console.error('[product-draft] closing edit sessions failed for', draftId, e)
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

    const body = await req.json().catch(() => ({}))
    const { draftId, existing } = await startProductDraft(actorOf(admin), id, {
      fresh: !!body?.new,
      title: typeof body?.title === 'string' ? body.title : null,
    })
    if (existing) return NextResponse.json({ success: true, productId: id, draftId, existing: true })
    await closeProductSessions(draftId)

    return NextResponse.json({ success: true, productId: id, draftId })
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

    const draftId = await productDraftIdFor(req, id, admin.adminId)
    if (!draftId) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

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
      draftId,
      db =>
        db.query(
          // The form never sends _files (staged digital-file changes); keep them.
          `UPDATE product_drafts SET fields = $2::jsonb || jsonb_strip_nulls(jsonb_build_object('_files', fields->'_files')),
           images = COALESCE($3::jsonb, images),
           variants = COALESCE($4::jsonb, variants),
           updated_at = NOW() WHERE id = $1`,
          [draftId, JSON.stringify(roundMoneyFields(fields)), imagesJson, variantsJson]
        ),
      { epoch: epochFrom(req) }
    )
    await applyDraftSubVariantPrices(draftId, parseSubVariantPriceEntries(body?.subVariantSubscriptionPrices))

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
  const draftId = await productDraftIdFor(req, id, admin.adminId)
  const denied = await discardGuard(actor, 'product', draftId ?? id)
  if (denied) return denied
  try {
    // Clean up S3 files for variant images that were uploaded fresh into this draft
    // (staged, never applied to live). Live-image rows (real uuid ids) are left alone —
    // their files still back the live product.
    const draft = draftId
      ? await queryOne<{ variant_images: any[]; images: any[] }>(`SELECT variant_images, images FROM product_drafts WHERE id = $1`, [draftId])
      : null

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
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
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
    await discardDraftFiles(draftId!)
    await query(`DELETE FROM product_drafts WHERE id = $1`, [draftId])
    await closeProductSessions(draftId!)
    await closeAfter(actor, 'product', draftId!, 'discarded')
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[product-draft] discard failed for', id, err)
    return NextResponse.json({ error: productErrorMessage(err, 'Failed to discard draft') }, { status: 500 })
  }
}
