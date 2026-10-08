import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'
import {
  uploadProductImage,
  copyGalleryImageToProduct,
  deleteProductImage,
  UploadValidationError,
} from '@/lib/shared/s3'
import { parseBody, zUuid } from '@/lib/shared/validate'

// Draft-scoped MAIN product images. Uploads go to S3 immediately, but the ROW is
// staged in product_drafts.images — NOT in live product_images. publishProductDraft()
// rebuilds live product_images from this staged set. Discarding the draft cleans up
// staged S3 files. Mirrors draft/variant-images, minus the per-variant scoping.

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

const MAX_IMAGES = 5
const GalleryPostSchema = z.object({ gallery_image_id: zUuid })
const DeleteSchema = z.object({ imageId: z.string() })
const PatchSchema = z.object({
  imageId: z.string(),
  isPrimary: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
})

async function getStage(productId: string): Promise<any[]> {
  const row = await queryOne<{ images: any[] }>(`SELECT images FROM product_drafts WHERE product_id = $1`, [productId])
  return Array.isArray(row?.images) ? row!.images : []
}

class StageError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
  }
}

// Read-modify-write of the staged array under a row lock, so concurrent uploads/edits never
// overwrite each other. `fn` returns the next array, or null for no change.
async function mutateStage<T>(productId: string, fn: (stage: any[]) => { next: any[] | null; result: T }): Promise<T> {
  return withTransaction(async client => {
    const r = await client.query(`SELECT images FROM product_drafts WHERE product_id = $1 FOR UPDATE`, [productId])
    if (!r.rows[0]) throw new StageError('No draft exists for this product. Reload the edit page and try again.', 404)
    const stage = Array.isArray(r.rows[0].images) ? r.rows[0].images : []
    const { next, result } = fn(stage)
    if (next) {
      await client.query(`UPDATE product_drafts SET images = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
        productId,
        JSON.stringify(next),
      ])
    }
    return result
  })
}

function errorResponse(err: any, productId: string, action: string) {
  if (err instanceof StageError) return NextResponse.json({ error: err.message }, { status: err.status })
  if (err instanceof UploadValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
  console.error(`[draft-images] ${action} failed for`, productId, err)
  return NextResponse.json({ error: err?.message || `Failed to ${action} image` }, { status: 500 })
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const stage = await getStage(id)
  const images = [...stage].sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
  return NextResponse.json({ images })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  let uploaded: { s3_key: string; s3_thumbnail_key: string } | null = null
  try {
    // Fast fail before uploading; the locked append below re-checks.
    if ((await getStage(id)).length >= MAX_IMAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_IMAGES} images per product` }, { status: 400 })
    }
    const contentType = request.headers.get('content-type') || ''

    let staged: any
    if (contentType.includes('application/json')) {
      const rawJson = await request.json().catch(() => null)
      if (!rawJson) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      const parsedJson = parseBody(GalleryPostSchema, rawJson)
      if (!parsedJson.ok) return parsedJson.response
      const gimg = await queryOne<any>(`SELECT * FROM gallery_images WHERE id = $1`, [parsedJson.data.gallery_image_id])
      if (!gimg) return NextResponse.json({ error: 'Gallery image not found' }, { status: 404 })
      if (!gimg.s3_key) return NextResponse.json({ error: 'Gallery image has no usable source' }, { status: 400 })
      const copied = await copyGalleryImageToProduct(gimg.s3_key, gimg.s3_thumbnail_key, id)
      staged = {
        id: `draft-img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        image_url: copied.url,
        thumbnail_url: copied.thumbnailUrl,
        s3_bucket: copied.s3Bucket,
        s3_key: copied.s3Key,
        s3_thumbnail_key: copied.s3ThumbnailKey,
        file_name: gimg.custom_name || gimg.file_name,
        file_size: gimg.file_size,
        mime_type: gimg.mime_type,
        width: gimg.width,
        height: gimg.height,
        alt_text: '',
        _staged: true,
        _fromGallery: true,
      }
    } else {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      const result = await uploadProductImage(file, id)
      staged = {
        id: `draft-img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        image_url: result.url,
        thumbnail_url: result.thumbnailUrl,
        s3_bucket: result.s3Bucket,
        s3_key: result.s3Key,
        s3_thumbnail_key: result.s3ThumbnailKey,
        file_name: result.fileName,
        file_size: result.fileSize,
        mime_type: result.mimeType,
        width: result.width,
        height: result.height,
        alt_text: '',
        _staged: true,
      }
    }
    uploaded = { s3_key: staged.s3_key, s3_thumbnail_key: staged.s3_thumbnail_key || '' }
    const image = await mutateStage(id, stage => {
      if (stage.length >= MAX_IMAGES) throw new StageError(`Maximum ${MAX_IMAGES} images per product`, 400)
      const img = { ...staged, display_order: stage.length, is_primary: stage.length === 0 }
      return { next: [...stage, img], result: img }
    })
    return NextResponse.json({ image })
  } catch (err: any) {
    // The file reached S3 but was not staged — remove it so it doesn't orphan.
    if (uploaded?.s3_key) await deleteProductImage(uploaded.s3_key, uploaded.s3_thumbnail_key).catch(() => {})
    return errorResponse(err, id, 'upload')
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawDel = await request.json().catch(() => null)
  if (!rawDel) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedDel = parseBody(DeleteSchema, rawDel)
  if (!parsedDel.ok) return parsedDel.response
  const { imageId } = parsedDel.data

  try {
    await mutateStage(id, stage => {
      const removed = stage.find((img: any) => img.id === imageId)
      let next = stage.filter((img: any) => img.id !== imageId)
      if (removed?.is_primary) {
        const rest = [...next].sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
        if (rest[0]) next = next.map((img: any) => (img.id === rest[0].id ? { ...img, is_primary: true } : img))
      }
      return { next, result: null }
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return errorResponse(err, id, 'remove')
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawPatch = await request.json().catch(() => null)
  if (!rawPatch) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedPatch = parseBody(PatchSchema, rawPatch)
  if (!parsedPatch.ok) return parsedPatch.response
  const { imageId, isPrimary, displayOrder } = parsedPatch.data

  try {
    await mutateStage(id, stage => ({
      next: stage.map((img: any) => {
        if (isPrimary) return { ...img, is_primary: img.id === imageId }
        if (displayOrder !== undefined && img.id === imageId) return { ...img, display_order: displayOrder }
        return img
      }),
      result: null,
    }))
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return errorResponse(err, id, 'update')
  }
}
