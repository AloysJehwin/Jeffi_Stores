import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import {
  copyGalleryImageToProduct,
  deleteObjectKey,
  getS3Url,
  inspectObject,
  presignProductMediaUpload,
  PRODUCT_MEDIA_KEY_RE,
  PRODUCT_MEDIA_TYPES,
  uploadProductImage,
  UploadValidationError,
} from '@/lib/shared/s3'
import { getMediaLimits } from '@/lib/catalog/product-media'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Media tab uploads. Files go to S3 now; the item is staged in the draft (fields._media) and only
// becomes a product_media row on publish.

interface Params {
  params: Promise<{ id: string }>
}

const Presign = z.object({
  action: z.literal('presign'),
  kind: z.enum(['document', 'audio', 'model_3d']),
  mimeType: z.string().max(100),
  size: z.number().int().positive(),
})
const Confirm = z.object({ action: z.literal('confirm'), key: z.string().max(300) })
const Gallery = z.object({ gallery_image_id: z.string().uuid() })

// Leading bytes each declared type must start with.
function looksLike(ext: string, head: Buffer): boolean {
  const ascii = (a: number, b: number) => head.subarray(a, b).toString('latin1')
  switch (ext) {
    case 'pdf':
      return ascii(0, 5) === '%PDF-'
    case 'glb':
      return ascii(0, 4) === 'glTF'
    case 'usdz':
      return head[0] === 0x50 && head[1] === 0x4b
    case 'ogg':
      return ascii(0, 4) === 'OggS'
    case 'm4a':
      return ascii(4, 8) === 'ftyp'
    case 'mp3':
      return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
    default:
      return false
  }
}

const mbOf = (limits: Awaited<ReturnType<typeof getMediaLimits>>, kind: string) =>
  kind === 'document' ? limits.documentMb : kind === 'audio' ? limits.audioMb : kind === 'model_3d' ? limits.modelMb : limits.imageMb

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!(await queryOne(`SELECT 1 FROM products WHERE id = $1`, [id])))
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  const limits = await getMediaLimits()

  try {
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const fd = await req.formData()
      const file = fd.get('file')
      if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
      if (file.size > limits.imageMb * 1024 * 1024)
        return NextResponse.json({ error: `Images are limited to ${limits.imageMb} MB` }, { status: 413 })
      const up = await uploadProductImage(file, id)
      return NextResponse.json({
        item: {
          url: up.url,
          thumbnail_url: up.thumbnailUrl,
          s3_key: up.s3Key,
          s3_thumbnail_key: up.s3ThumbnailKey,
          file_name: up.fileName,
          mime: up.mimeType,
          size_bytes: up.fileSize,
          width: up.width || null,
          height: up.height || null,
          metadata: up.blurhash ? { blurhash: up.blurhash } : {},
        },
      })
    }

    const body = await req.json().catch(() => null)
    const gallery = Gallery.safeParse(body)
    if (gallery.success) {
      const g = await queryOne<any>(`SELECT * FROM gallery_images WHERE id = $1`, [gallery.data.gallery_image_id])
      if (!g) return NextResponse.json({ error: 'Gallery image not found' }, { status: 404 })
      const c = await copyGalleryImageToProduct(g.s3_key, g.s3_thumbnail_key, id)
      return NextResponse.json({
        item: {
          url: c.url,
          thumbnail_url: c.thumbnailUrl,
          s3_key: c.s3Key,
          s3_thumbnail_key: c.s3ThumbnailKey,
          file_name: g.custom_name || g.file_name,
          mime: c.mimeType ?? g.mime_type ?? null,
          size_bytes: g.file_size ?? null,
          width: g.width ?? null,
          height: g.height ?? null,
          metadata: g.blurhash ? { blurhash: g.blurhash } : {},
        },
      })
    }

    const presign = Presign.safeParse(body)
    if (presign.success) {
      const { kind, mimeType, size } = presign.data
      const ext = PRODUCT_MEDIA_TYPES[mimeType]
      const ok = ext && (kind === 'document' ? ext === 'pdf' : kind === 'audio' ? ['mp3', 'm4a', 'ogg'].includes(ext) : ['glb', 'usdz'].includes(ext))
      if (!ok) return NextResponse.json({ error: 'That file type is not allowed here' }, { status: 400 })
      const mb = mbOf(limits, kind)
      if (size > mb * 1024 * 1024) return NextResponse.json({ error: `Limit is ${mb} MB` }, { status: 413 })
      return NextResponse.json(await presignProductMediaUpload(id, mimeType, size))
    }

    const confirm = Confirm.safeParse(body)
    if (confirm.success) {
      const key = confirm.data.key
      if (!PRODUCT_MEDIA_KEY_RE.test(key) || !key.startsWith(`products/${id}/`))
        return NextResponse.json({ error: 'Invalid key' }, { status: 400 })
      const obj = await inspectObject(key, 16)
      if (!obj) return NextResponse.json({ error: 'The upload did not arrive. Try again.' }, { status: 400 })
      const ext = key.split('.').pop()!
      if (!looksLike(ext, obj.head)) {
        await deleteObjectKey(key).catch(() => {})
        return NextResponse.json({ error: `That is not a valid .${ext} file` }, { status: 400 })
      }
      return NextResponse.json({ url: await getS3Url(key), key, size: obj.size })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (err) {
    if (err instanceof UploadValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[product-media] upload failed for', id, err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
