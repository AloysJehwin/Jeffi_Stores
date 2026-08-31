import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { uploadVariantImage, getS3Url } from '@/lib/s3'
import { parseBody, zUuid } from '@/lib/validate'

// Draft-scoped variant images. Uploads go to S3 immediately (a file must physically
// exist before publish), but the ROW is staged in product_drafts.variant_images —
// NOT in live variant_images. publishProductDraft() reconciles the staged set onto
// live per variant. Discarding the draft cleans up staged S3 files.
//
// Staging shape: product_drafts.variant_images is a flat array; each row is a full
// variant_images-like object tagged with variant_id. New rows get a `draft-vi-…` id;
// existing live rows keep their real uuid id so publish can preserve/remove them.

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

function getVariantId(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get('variant_id')
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
  const row = await queryOne<{ variant_images: any[] }>(
    `SELECT variant_images FROM product_drafts WHERE product_id = $1`, [productId]
  )
  return Array.isArray(row?.variant_images) ? row!.variant_images : []
}

async function saveStage(productId: string, stage: any[]): Promise<void> {
  await query(
    `UPDATE product_drafts SET variant_images = $2::jsonb, updated_at = NOW() WHERE product_id = $1`,
    [productId, JSON.stringify(stage)]
  )
}

function forVariant(stage: any[], variantId: string): any[] {
  return stage.filter((vi: any) => vi.variant_id === variantId)
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const variantId = getVariantId(request)
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const stage = await getStage(id)
  const images = forVariant(stage, variantId)
    .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
  return NextResponse.json({ images })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const variantId = getVariantId(request)
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const stage = await getStage(id)
    const existing = forVariant(stage, variantId)
    if (existing.length >= MAX_IMAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_IMAGES} images per variant` }, { status: 400 })
    }
    const isPrimary = existing.length === 0
    const contentType = request.headers.get('content-type') || ''

    let staged: any
    if (contentType.includes('application/json')) {
      const rawJson = await request.json().catch(() => null)
      if (!rawJson) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      const parsedJson = parseBody(GalleryPostSchema, rawJson)
      if (!parsedJson.ok) return parsedJson.response
      const gimg = await queryOne<any>(`SELECT * FROM gallery_images WHERE id = $1`, [parsedJson.data.gallery_image_id])
      if (!gimg) return NextResponse.json({ error: 'Gallery image not found' }, { status: 404 })
      const imageUrl = gimg.image_url || (gimg.s3_key ? await getS3Url(gimg.s3_key) : null)
      if (!imageUrl) return NextResponse.json({ error: 'Gallery image has no usable URL' }, { status: 400 })
      staged = {
        id: `draft-vi-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        variant_id: variantId,
        image_url: imageUrl,
        thumbnail_url: gimg.thumbnail_url || (gimg.s3_thumbnail_key ? await getS3Url(gimg.s3_thumbnail_key) : null),
        s3_bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
        s3_key: gimg.s3_key, s3_thumbnail_key: gimg.s3_thumbnail_key,
        file_name: gimg.custom_name || gimg.file_name, file_size: gimg.file_size, mime_type: gimg.mime_type,
        width: gimg.width, height: gimg.height, display_order: existing.length, is_primary: isPrimary,
        _fromGallery: true,
      }
    } else {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      const result = await uploadVariantImage(file, variantId)
      staged = {
        id: `draft-vi-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        variant_id: variantId,
        image_url: result.url, thumbnail_url: result.thumbnailUrl,
        s3_bucket: process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
        s3_key: result.s3Key, s3_thumbnail_key: result.s3ThumbnailKey,
        file_name: result.fileName, file_size: result.fileSize, mime_type: result.mimeType,
        width: result.width, height: result.height, display_order: existing.length, is_primary: isPrimary,
        _staged: true, // freshly uploaded S3 file, not yet in live variant_images
      }
    }
    await saveStage(id, [...stage, staged])
    return NextResponse.json({ image: staged })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const variantId = getVariantId(request)
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawDel = await request.json().catch(() => null)
  if (!rawDel) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedDel = parseBody(DeleteSchema, rawDel)
  if (!parsedDel.ok) return parsedDel.response
  const { imageId } = parsedDel.data

  const stage = await getStage(id)
  const removed = stage.find((vi: any) => vi.id === imageId && vi.variant_id === variantId)
  // Drop the row from the stage. We do NOT delete the S3 file here: for a freshly
  // staged upload the file is cleaned up on draft discard; for a live image, the file
  // stays until publish actually removes it from live variant_images.
  let next = stage.filter((vi: any) => !(vi.id === imageId && vi.variant_id === variantId))
  // If we removed the primary, promote the first remaining image for this variant.
  if (removed?.is_primary) {
    const rest = next.filter((vi: any) => vi.variant_id === variantId)
      .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
    if (rest[0]) next = next.map((vi: any) => vi.id === rest[0].id ? { ...vi, is_primary: true } : vi)
  }
  await saveStage(id, next)
  return NextResponse.json({ success: true })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const variantId = getVariantId(request)
  if (!variantId) return NextResponse.json({ error: 'variant_id required' }, { status: 400 })
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawPatch = await request.json().catch(() => null)
  if (!rawPatch) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedPatch = parseBody(PatchSchema, rawPatch)
  if (!parsedPatch.ok) return parsedPatch.response
  const { imageId, isPrimary, displayOrder } = parsedPatch.data

  const stage = await getStage(id)
  const next = stage.map((vi: any) => {
    if (vi.variant_id !== variantId) return vi
    if (isPrimary) return { ...vi, is_primary: vi.id === imageId }
    if (displayOrder !== undefined && vi.id === imageId) return { ...vi, display_order: displayOrder }
    return vi
  })
  await saveStage(id, next)
  return NextResponse.json({ success: true })
}
