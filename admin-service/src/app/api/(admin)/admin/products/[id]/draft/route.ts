import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { normalizeExtraFields } from '@/lib/catalog/product-extra-fields'
import { productErrorMessage, roundMoneyFields } from '@/lib/catalog/product-validation'
import { normalizeSubscriptionPrice, normalizeSubscriptionPrices } from '@/lib/subscriptions/sellable'
import { applyDraftSubVariantPrices, parseSubVariantPriceEntries } from '@/lib/subscriptions/sub-variant-prices'
import {
  acquireDraftLock,
  actorOf,
  draftLockResponse,
  epochFrom,
  withDraftCreate,
  withDraftWrite,
} from '@/lib/admin/draft-locks'
import { productDraftIdFor, startProductDraft } from '@/lib/catalog/product-draft-id'
import { closeProductSessions, discardProductDraft } from '@/lib/catalog/product-draft-discard'
import { discardReply } from '@/lib/admin/discard-rows'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
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
    Object.assign(fields, normalizeExtraFields(fields))

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
          // Merged over the draft: keys the form does not send (currency, AI copy, _files, …) are kept.
          `UPDATE product_drafts SET fields = COALESCE(fields, '{}'::jsonb) || $2::jsonb,
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
  try {
    return discardReply(await discardProductDraft(actor, id, draftId))
  } catch (err: unknown) {
    console.error('[product-draft] discard failed for', id, err)
    return NextResponse.json({ error: productErrorMessage(err, 'Failed to discard draft') }, { status: 500 })
  }
}
