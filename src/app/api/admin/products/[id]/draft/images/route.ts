import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'
import { uploadProductImage, copyGalleryImageToProduct } from '@/lib/s3'
import { parseBody, zUuid } from '@/lib/validate'

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

async function saveStage(productId: string, stage: any[]): Promise<void> {
  await query(`UPDATE product_drafts SET images = $2::jsonb, updated_at = NOW() WHERE product_id = $1`, [
    productId,
    JSON.stringify(stage),
  ])
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

  try {
    const stage = await getStage(id)
    if (stage.length >= MAX_IMAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_IMAGES} images per product` }, { status: 400 })
    }
    const isPrimary = stage.length === 0
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
        display_order: stage.length,
        is_primary: isPrimary,
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
        display_order: stage.length,
        is_primary: isPrimary,
        _staged: true,
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
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawDel = await request.json().catch(() => null)
  if (!rawDel) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedDel = parseBody(DeleteSchema, rawDel)
  if (!parsedDel.ok) return parsedDel.response
  const { imageId } = parsedDel.data

  const stage = await getStage(id)
  const removed = stage.find((img: any) => img.id === imageId)
  let next = stage.filter((img: any) => img.id !== imageId)
  if (removed?.is_primary) {
    const rest = [...next].sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
    if (rest[0]) next = next.map((img: any) => (img.id === rest[0].id ? { ...img, is_primary: true } : img))
  }
  await saveStage(id, next)
  return NextResponse.json({ success: true })
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

  const stage = await getStage(id)
  const next = stage.map((img: any) => {
    if (isPrimary) return { ...img, is_primary: img.id === imageId }
    if (displayOrder !== undefined && img.id === imageId) return { ...img, display_order: displayOrder }
    return img
  })
  await saveStage(id, next)
  return NextResponse.json({ success: true })
}
