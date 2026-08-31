import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne, queryMany } from '@/lib/db'
import { uploadVariantImage, deleteProductImage, getS3Url } from '@/lib/s3'
import { parseBody, zUuid } from '@/lib/validate'

const GalleryPostSchema = z.object({ gallery_image_id: zUuid })
const DeleteSchema = z.object({ imageId: zUuid })
const PatchSchema = z.object({
  imageId: zUuid,
  isPrimary: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
})

const MAX_IMAGES = 5

type Params = { params: Promise<{ id: string; variantId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const images = await queryMany(
    `SELECT * FROM variant_images WHERE variant_id = $1 ORDER BY display_order ASC, created_at ASC`,
    [variantId]
  )
  return NextResponse.json({ images })
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const variant = await queryOne(
      `SELECT id FROM product_variants WHERE id = $1 AND product_id = $2`,
      [variantId, id]
    )
    if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

    const existing = await queryMany(
      `SELECT id FROM variant_images WHERE variant_id = $1`,
      [variantId]
    )
    if (existing.length >= MAX_IMAGES) {
      return NextResponse.json({ error: `Maximum ${MAX_IMAGES} images per variant` }, { status: 400 })
    }

    const contentType = request.headers.get('content-type') || ''
    const isPrimary = existing.length === 0

    if (contentType.includes('application/json')) {
      const rawJson = await request.json().catch(() => null)
      if (!rawJson) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      const parsedJson = parseBody(GalleryPostSchema, rawJson)
      if (!parsedJson.ok) return parsedJson.response
      const { gallery_image_id } = parsedJson.data
      const gimg = await queryOne(
        `SELECT * FROM gallery_images WHERE id = $1`,
        [gallery_image_id]
      )
      if (!gimg) return NextResponse.json({ error: 'Gallery image not found' }, { status: 404 })
      const imageUrl = gimg.image_url || (gimg.s3_key ? await getS3Url(gimg.s3_key) : null)
      const thumbnailUrl = gimg.thumbnail_url || (gimg.s3_thumbnail_key ? await getS3Url(gimg.s3_thumbnail_key) : null)
      if (!imageUrl) return NextResponse.json({ error: 'Gallery image has no usable URL' }, { status: 400 })

      try {
        const head = await fetch(imageUrl, { method: 'HEAD' })
        if (!head.ok) {
          return NextResponse.json({
            error: `Gallery image file is missing from storage (HTTP ${head.status}). The original file may have been deleted. Please re-upload it.`
          }, { status: 410 })
        }
      } catch {
        return NextResponse.json({ error: 'Could not reach gallery image storage. Try again or re-upload the image.' }, { status: 502 })
      }
      const image = await queryOne(
        `INSERT INTO variant_images
           (variant_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
            file_name, file_size, mime_type, width, height, display_order, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          variantId, imageUrl, thumbnailUrl,
          process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
          gimg.s3_key, gimg.s3_thumbnail_key,
          gimg.custom_name || gimg.file_name, gimg.file_size, gimg.mime_type,
          gimg.width, gimg.height, existing.length, isPrimary,
        ]
      )
      return NextResponse.json({ image })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const result = await uploadVariantImage(file, variantId)

    const image = await queryOne(
      `INSERT INTO variant_images
         (variant_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key,
          file_name, file_size, mime_type, width, height, display_order, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        variantId, result.url, result.thumbnailUrl,
        process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
        result.s3Key, result.s3ThumbnailKey,
        result.fileName, result.fileSize, result.mimeType,
        result.width, result.height, existing.length, isPrimary,
      ]
    )
    return NextResponse.json({ image })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawDel = await request.json().catch(() => null)
  if (!rawDel) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedDel = parseBody(DeleteSchema, rawDel)
  if (!parsedDel.ok) return parsedDel.response
  const { imageId } = parsedDel.data

  const image = await queryOne(
    `SELECT * FROM variant_images WHERE id = $1 AND variant_id = $2`,
    [imageId, variantId]
  )
  if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  if (image.s3_key) {
    await deleteProductImage(image.s3_key, image.s3_thumbnail_key || '')
  }
  await query(`DELETE FROM variant_images WHERE id = $1`, [imageId])

  if (image.is_primary) {
    await query(
      `UPDATE variant_images SET is_primary = TRUE
       WHERE id = (SELECT id FROM variant_images WHERE variant_id = $1 ORDER BY display_order ASC LIMIT 1)`,
      [variantId]
    )
  }
  return NextResponse.json({ success: true })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id, variantId } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const rawPatch = await request.json().catch(() => null)
  if (!rawPatch) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsedPatch = parseBody(PatchSchema, rawPatch)
  if (!parsedPatch.ok) return parsedPatch.response
  const { imageId, isPrimary, displayOrder } = parsedPatch.data

  if (isPrimary) {
    await query(`UPDATE variant_images SET is_primary = FALSE WHERE variant_id = $1`, [variantId])
    await query(`UPDATE variant_images SET is_primary = TRUE WHERE id = $1`, [imageId])
  }
  if (displayOrder !== undefined) {
    await query(`UPDATE variant_images SET display_order = $1 WHERE id = $2`, [displayOrder, imageId])
  }
  return NextResponse.json({ success: true })
}
