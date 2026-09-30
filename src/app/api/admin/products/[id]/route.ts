import { NextRequest, NextResponse } from 'next/server'
import { getProduct } from '@/lib/queries'
import { query, withTransaction } from '@/lib/db'
import { deleteProductCascadeTx } from '@/lib/product-delete'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope, isPlatformOwner } from '@/lib/scopes'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseBody, zNonEmpty, zCurrency, zUuid } from '@/lib/validate'

const patchSchema = z
  .object({
    name: zNonEmpty.optional(),
    basePrice: zCurrency.optional(),
    sku: zNonEmpty.optional(),
    categoryId: zUuid.optional(),
  })
  .refine(d => Object.values(d).some(v => v !== undefined), {
    message: 'At least one field is required',
  })

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const product = await getProduct(id)
    return NextResponse.json(product)
  } catch (err: any) {
    if (err.message === 'Product not found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const raw = await req.json()
  const parsed = parseBody(patchSchema, raw)
  if (!parsed.ok) return parsed.response

  const body = raw
  const { category_id } = body
  if (!category_id) return NextResponse.json({ error: 'category_id required' }, { status: 400 })

  await query('UPDATE products SET category_id = $1, updated_at = $2 WHERE id = $3', [
    category_id,
    new Date().toISOString(),
    id,
  ])
  revalidatePath('/admin/products')
  revalidatePath('/admin/categories')

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isPlatformOwner(admin.role))
      return NextResponse.json({ error: 'Only platform owners can delete products' }, { status: 403 })

    const product = await query(`SELECT id FROM products WHERE id = $1`, [id])
    if (!product.rowCount) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    // Collect S3 keys before the DB rows vanish, so we can clean the bucket after commit.
    const imgs = await query<{ s3_key: string | null; s3_thumbnail_key: string | null }>(
      `SELECT s3_key, s3_thumbnail_key FROM product_images WHERE product_id = $1`,
      [id]
    )
    const variantImgs = await query<{ s3_key: string | null; s3_thumbnail_key: string | null }>(
      `SELECT vi.s3_key, vi.s3_thumbnail_key FROM variant_images vi
       JOIN product_variants pv ON pv.id = vi.variant_id WHERE pv.product_id = $1`,
      [id]
    )

    // Atomic FORCE delete — removes the product and every referencing record,
    // including purchase history (GRN + PO line items) and all variant/unit data.
    await withTransaction(client => deleteProductCascadeTx(client, id))

    // Best-effort S3 cleanup (outside the txn — object store isn't transactional).
    const { deleteProductImage } = await import('@/lib/s3')
    for (const img of [...imgs.rows, ...variantImgs.rows]) {
      if (img.s3_key && img.s3_thumbnail_key) {
        try {
          await deleteProductImage(img.s3_key, img.s3_thumbnail_key)
        } catch {
          /* orphan cleanup best-effort */
        }
      }
    }

    revalidatePath('/admin/products')
    return NextResponse.json({ success: true })
  } catch (err: any) {
    // FK violation → product is still referenced by a record we don't auto-clear.
    if (err?.code === '23503') {
      return NextResponse.json(
        {
          error: `Product is still referenced by ${err?.table || 'another record'} and cannot be deleted.`,
          detail: err?.detail,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 })
  }
}
