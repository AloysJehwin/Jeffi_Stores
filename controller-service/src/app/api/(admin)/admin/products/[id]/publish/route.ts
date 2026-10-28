import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, query } from '@/lib/shared/db'
import { revalidatePath } from 'next/cache'
import {
  publishProductDraft,
  openOrdersForProduct,
  OpenOrdersBlockError,
  UnitChangeBlockedError,
} from '@/lib/catalog/product-draft'
import {
  productErrorMessage,
  ProductValidationError,
  storedProductPublishErrors,
} from '@/lib/catalog/product-validation'
import { actorOf, draftLockResponse, epochFrom, withDraftPublish } from '@/lib/admin/draft-locks'
import { draftConflictResponse } from '@/lib/admin/draft-branches'
import { productDraftIdFor } from '@/lib/catalog/product-draft-id'

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
    // ?draft=<id> (body { resolutions } after a merge-dialog round); a create-draft has none.
    const draftId = await productDraftIdFor(req, id, admin.adminId)
    const body = await req.json().catch(() => ({}))

    if (!draftId) {
      // Create-draft (is_draft=true, no product_drafts edit-draft): publish by flipping the flags
      // directly, mirroring brands/coupons. Open-order block still applies.
      const createDraft = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1 AND is_draft = true`, [
        id,
      ])
      if (!createDraft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

      // Same publish rules as the form: name, category, prices, weight / package dims.
      const errors = await storedProductPublishErrors({ query }, id)
      if (errors.length > 0) {
        return NextResponse.json(
          { error: `Cannot publish yet: ${errors[0]} Open the draft to complete it.`, details: errors },
          { status: 400 }
        )
      }

      const blockingCd = await openOrdersForProduct(id)
      if (blockingCd.length > 0) {
        return NextResponse.json(
          {
            error: `Cannot publish: ${blockingCd.length} open order(s) (${blockingCd.join(', ')}) are pending/confirmed. Move them past 'confirmed' or cancel them first.`,
            openOrders: blockingCd,
          },
          { status: 409 }
        )
      }

      await withDraftPublish(
        actorOf(admin),
        'product',
        id,
        db => db.query(`UPDATE products SET is_draft = false, is_active = true, updated_at = NOW() WHERE id = $1`, [id]),
        { epoch: epochFrom(req) }
      )
      revalidatePath('/admin/products')
      return NextResponse.json({ success: true, productId: id })
    }

    // Block publish while open (pending/confirmed) orders reference this product —
    // publishing could remove variants / rename SKUs and break their stock.
    const blocking = await openOrdersForProduct(id)
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot publish: ${blocking.length} open order(s) (${blocking.join(', ')}) are pending/confirmed. Move them past 'confirmed' or cancel them first.`,
          openOrders: blocking,
        },
        { status: 409 }
      )
    }

    await publishProductDraft(id, { activate: true, actor: actorOf(admin), epoch: epochFrom(req), draftId, resolutions: body?.resolutions })
    revalidatePath('/admin/products')
    return NextResponse.json({ success: true, productId: id })
  } catch (err: unknown) {
    const handled = draftLockResponse(err) ?? draftConflictResponse(err)
    if (handled) return handled
    console.error('[product-publish] publish failed for', id, err)
    const status =
      err instanceof OpenOrdersBlockError || err instanceof UnitChangeBlockedError
        ? 409
        : err instanceof ProductValidationError
          ? 400
          : 500
    return NextResponse.json({ error: productErrorMessage(err, 'Failed to publish draft') }, { status })
  }
}
