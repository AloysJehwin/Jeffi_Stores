import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { encode as encodeBlurhash } from 'blurhash'
import { getCurrentTenant } from './tenant-context'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const DEFAULT_BUCKET = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
const KEY_PREFIX = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : ''
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL?.replace(/\/$/, '') ?? ''

/**
 * The bucket for the store this request belongs to. Falls back to the header when the ALS
 * context has not been established yet (it is set lazily by the first DB query), so an upload
 * on a tenant host cannot land in the platform bucket.
 */
async function resolveBucket(): Promise<string> {
  const t = getCurrentTenant()
  if (t?.infra?.s3Bucket) return t.infra.s3Bucket
  try {
    const { headers } = await import('next/headers')
    const slug = (await headers()).get('x-tenant-slug')
    if (slug) {
      const { lookupTenantContextBySlug } = await import('./tenant-registry')
      const ctx = await lookupTenantContextBySlug(slug)
      if (ctx?.infra?.s3Bucket) return ctx.infra.s3Bucket
    }
  } catch { /* outside a request scope (jobs) — platform bucket is correct */ }
  return DEFAULT_BUCKET
}

/** The S3 bucket this request's tenant writes to (tenant bucket, platform fallback).
 * Exposed for DB writes that must record the same bucket the object physically lands in. */
export async function currentBucket(): Promise<string> {
  return resolveBucket()
}

// The platform CloudFront distribution only fronts the platform bucket, so a tenant object
// must be addressed directly or the URL 404s.
function publicUrl(bucket: string, fullKey: string): string {
  if (bucket === DEFAULT_BUCKET && CLOUDFRONT_URL) return `${CLOUDFRONT_URL}/${fullKey}`
  return `https://${bucket}.s3.${AWS_REGION}.amazonaws.com/${fullKey}`
}

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// Compact colour placeholder rendered while the full image loads. Returns null on any failure —
// callers store null and the UI falls back to its skeleton, so this can never fail an upload.
export async function computeBlurhash(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: 'inside' })
      .toBuffer({ resolveWithObject: true })
    return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3)
  } catch {
    return null
  }
}

export async function getS3Url(canonicalKey: string): Promise<string> {
  const fullKey = KEY_PREFIX ? `${KEY_PREFIX}${canonicalKey}` : canonicalKey
  return publicUrl(await resolveBucket(), fullKey)
}

export function generateProductImageKeys(productId: string, fileName: string) {
  const timestamp = Date.now()
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  return {
    imageKey: `products/${productId}/${timestamp}-${sanitizedName}`,
    thumbnailKey: `products/${productId}/thumbnails/${timestamp}-${sanitizedName}`,
  }
}

export interface UploadResult {
  url: string
  thumbnailUrl: string
  s3Bucket: string
  s3Key: string
  s3ThumbnailKey: string
  fileName: string
  fileSize: number
  mimeType: string
  width: number
  height: number
  blurhash: string | null
}

export async function uploadProductImage(file: File, productId: string): Promise<UploadResult> {
  const BUCKET_NAME = await resolveBucket()
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size exceeds 5MB limit.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const metadata = await sharp(buffer).rotate().metadata()
  const { imageKey: s3Key, thumbnailKey: s3ThumbnailKey } = generateProductImageKeys(productId, file.name)
  const thumbnailBuffer = await sharp(buffer).rotate().resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
  const blurhash = await computeBlurhash(buffer)

  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3Key}`, Body: buffer, ContentType: file.type }))
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3ThumbnailKey}`, Body: thumbnailBuffer, ContentType: 'image/jpeg' }))

  return {
    url: await getS3Url(s3Key),
    thumbnailUrl: await getS3Url(s3ThumbnailKey),
    s3Bucket: BUCKET_NAME,
    s3Key,
    s3ThumbnailKey,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    width: metadata.width || 0,
    height: metadata.height || 0,
    blurhash,
  }
}

export async function uploadInvoicePDF(pdfBuffer: Buffer, invoiceNumber: string, financialYear: string): Promise<string> {
  const BUCKET_NAME = await resolveBucket()
  const safeFileName = invoiceNumber.replace(/\//g, '-')
  const s3Key = `invoices/${financialYear}/${safeFileName}.pdf`
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `${KEY_PREFIX}${s3Key}`,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    ContentDisposition: `inline; filename="${safeFileName}.pdf"`,
  }))
  return await getS3Url(s3Key)
}

export async function deleteProductImage(s3Key: string, s3ThumbnailKey: string) {
  const BUCKET_NAME = await resolveBucket()
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3Key}` }))
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3ThumbnailKey}` }))
}

export async function saveProductImages(
  productId: string,
  images: { url: string; thumbnailUrl: string; s3Key: string; s3ThumbnailKey: string; fileName: string; fileSize: number; mimeType: string; width: number; height: number; blurhash?: string | null; altText?: string; isPrimary?: boolean }[]
) {
  const BUCKET_NAME = await resolveBucket()
  const { query } = await import('./db')
  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    await query(
      `INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, file_size, mime_type, width, height, blurhash, alt_text, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [productId, image.url, image.thumbnailUrl, BUCKET_NAME, image.s3Key, image.s3ThumbnailKey, image.fileName, image.fileSize, image.mimeType, image.width, image.height, image.blurhash ?? null, image.altText || '', i, image.isPrimary || i === 0]
    )
  }
}

export interface GalleryUploadResult {
  url: string
  thumbnailUrl: string
  s3Key: string
  s3ThumbnailKey: string
  fileName: string
  fileSize: number
  width: number
  height: number
  blurhash: string | null
}

export async function uploadGalleryImage(imageBuffer: Buffer, fileName: string): Promise<GalleryUploadResult> {
  const BUCKET_NAME = await resolveBucket()
  const timestamp = Date.now()
  const baseName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '')
  const s3Key = `gallery/${timestamp}-${baseName}.png`
  const s3ThumbnailKey = `gallery/thumbnails/${timestamp}-${baseName}.png`

  const metadata = await sharp(imageBuffer).rotate().metadata()
  const pngBuffer = await sharp(imageBuffer).rotate().png({ compressionLevel: 8 }).toBuffer()
  const thumbnailBuffer = await sharp(imageBuffer).rotate().resize(300, 300, { fit: 'cover' }).png({ compressionLevel: 8 }).toBuffer()
  const blurhash = await computeBlurhash(imageBuffer)

  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3Key}`, Body: pngBuffer, ContentType: 'image/png' }))
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3ThumbnailKey}`, Body: thumbnailBuffer, ContentType: 'image/png' }))

  return {
    url: await getS3Url(s3Key),
    thumbnailUrl: await getS3Url(s3ThumbnailKey),
    s3Key,
    s3ThumbnailKey,
    fileName: `${baseName}.png`,
    fileSize: pngBuffer.length,
    width: metadata.width || 0,
    height: metadata.height || 0,
    blurhash,
  }
}

// Resolve where a gallery object physically lives on S3. Objects predating the
// S3_KEY_PREFIX convention sit at the bare key; newer ones under `${KEY_PREFIX}`.
// Try the prefixed path first, then the bare path. Returns the CopySource-ready
// key (relative to the bucket), or null if the object exists at neither.
async function resolveSourceKey(canonicalKey: string): Promise<string | null> {
  const BUCKET_NAME = await resolveBucket()
  const prefixed = `${KEY_PREFIX}${canonicalKey}`
  try { await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: prefixed })); return prefixed } catch {}
  if (KEY_PREFIX) {
    try { await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: canonicalKey })); return canonicalKey } catch {}
  }
  return null
}

export async function copyGalleryImageToProduct(
  galleryS3Key: string,
  galleryS3ThumbnailKey: string,
  productId: string,
): Promise<{ s3Bucket: string; s3Key: string; s3ThumbnailKey: string; url: string; thumbnailUrl: string }> {
  const BUCKET_NAME = await resolveBucket()
  const fileName = galleryS3Key.replace(/^gallery\//, '')
  const thumbFileName = galleryS3ThumbnailKey.replace(/^gallery\/thumbnails\//, '')

  const s3Key = `products/${productId}/${fileName}`
  const s3ThumbnailKey = `products/${productId}/thumbnails/${thumbFileName}`

  // Resolve the real source location. If the gallery object doesn't exist, THROW —
  // never fall back to the gallery key, or the product row would point at gallery/…
  // (the exact bug that left products sharing gallery objects). Callers must handle
  // the throw (skip that image / surface an error) rather than store a bad path.
  const srcKey = await resolveSourceKey(galleryS3Key)
  if (!srcKey) {
    throw new Error(`Gallery source image not found on S3: ${galleryS3Key} (checked ${KEY_PREFIX}${galleryS3Key} and bare). Cannot copy to product ${productId}.`)
  }

  await s3Client.send(new CopyObjectCommand({
    Bucket: BUCKET_NAME,
    CopySource: `${BUCKET_NAME}/${srcKey}`,
    Key: `${KEY_PREFIX}${s3Key}`,
  }))

  // Thumbnail is best-effort: if the gallery thumb is missing, reuse the full image
  // as the product thumbnail (still a product-owned key, never a gallery key).
  const srcThumbKey = await resolveSourceKey(galleryS3ThumbnailKey)
  if (srcThumbKey) {
    await s3Client.send(new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${srcThumbKey}`,
      Key: `${KEY_PREFIX}${s3ThumbnailKey}`,
    }))
    return { s3Bucket: BUCKET_NAME, s3Key, s3ThumbnailKey, url: await getS3Url(s3Key), thumbnailUrl: await getS3Url(s3ThumbnailKey) }
  }
  return { s3Bucket: BUCKET_NAME, s3Key, s3ThumbnailKey: s3Key, url: await getS3Url(s3Key), thumbnailUrl: await getS3Url(s3Key) }
}

export async function uploadVariantImage(file: File, variantId: string): Promise<UploadResult> {
  const BUCKET_NAME = await resolveBucket()
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size exceeds 5MB limit.')
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const metadata = await sharp(buffer).rotate().metadata()
  const timestamp = Date.now()
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const s3Key = `products/variants/${variantId}/${timestamp}-${sanitizedName}`
  const s3ThumbnailKey = `products/variants/${variantId}/thumbnails/${timestamp}-${sanitizedName}`
  const thumbnailBuffer = await sharp(buffer).rotate().resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
  const blurhash = await computeBlurhash(buffer)
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3Key}`, Body: buffer, ContentType: file.type }))
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3ThumbnailKey}`, Body: thumbnailBuffer, ContentType: 'image/jpeg' }))
  return {
    url: await getS3Url(s3Key),
    thumbnailUrl: await getS3Url(s3ThumbnailKey),
    s3Bucket: BUCKET_NAME,
    s3Key,
    s3ThumbnailKey,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    width: metadata.width || 0,
    height: metadata.height || 0,
    blurhash,
  }
}

export async function uploadReviewImage(file: File, reviewId: string): Promise<{ url: string; thumbnailUrl: string }> {
  const BUCKET_NAME = await resolveBucket()
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size exceeds 5MB limit.')
  }
  const timestamp = Date.now()
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const s3Key = `reviews/${reviewId}/${timestamp}-${sanitizedName}`
  const s3ThumbnailKey = `reviews/${reviewId}/thumbnails/${timestamp}-${sanitizedName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const resized = await sharp(buffer).rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  const thumbnail = await sharp(buffer).rotate().resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3Key}`, Body: resized, ContentType: 'image/jpeg' }))
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3ThumbnailKey}`, Body: thumbnail, ContentType: 'image/jpeg' }))
  return { url: await getS3Url(s3Key), thumbnailUrl: await getS3Url(s3ThumbnailKey) }
}

export async function uploadAvatarImage(buffer: Buffer, userId: string): Promise<{ url: string; s3Key: string }> {
  const BUCKET_NAME = await resolveBucket()
  const s3Key = `avatars/${userId}.jpg`
  const resized = await sharp(buffer).rotate().resize(256, 256, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer()
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `${KEY_PREFIX}${s3Key}`,
    Body: resized,
    ContentType: 'image/jpeg',
  }))
  return { url: await getS3Url(s3Key), s3Key }
}

// Store logo. Preserves transparency (PNG), fits within a wide bounding box so
// horizontal wordmark logos aren't cropped. Cache-busted via a version query param
// on the returned URL so replacing the logo takes effect immediately.
export async function uploadStoreLogo(buffer: Buffer): Promise<{ url: string; s3Key: string }> {
  const BUCKET_NAME = await resolveBucket()
  const s3Key = `branding/store-logo.png`
  const resized = await sharp(buffer)
    .rotate()
    .resize(600, 200, { fit: 'inside', withoutEnlargement: true })
    .png({ quality: 90 })
    .toBuffer()
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `${KEY_PREFIX}${s3Key}`,
    Body: resized,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=60',
  }))
  return { url: `${await getS3Url(s3Key)}?v=${Date.now()}`, s3Key }
}

// Per-owner branding asset (logo/seal) captured during onboarding — distinct from the global
// platform store-logo above. Publicly readable (storefront + legal-doc + social use). Key is
// owner-scoped so each tenant owner has their own.
export async function uploadBrandingImage(buffer: Buffer, ownerId: string, kind: 'logo' | 'seal'): Promise<{ url: string; s3Key: string }> {
  const BUCKET_NAME = await resolveBucket()
  const s3Key = `branding/${ownerId}/${kind}.png`
  const resized = await sharp(buffer)
    .rotate()
    .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
    .png({ quality: 90 })
    .toBuffer()
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: `${KEY_PREFIX}${s3Key}`,
    Body: resized,
    ContentType: 'image/png',
    CacheControl: 'public, max-age=60',
  }))
  return { url: `${await getS3Url(s3Key)}?v=${Date.now()}`, s3Key }
}


export async function deleteGalleryImage(s3Key: string, s3ThumbnailKey: string) {
  const BUCKET_NAME = await resolveBucket()
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3Key}` }))
  if (s3ThumbnailKey) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${s3ThumbnailKey}` }))
  }
}

// Fetch a remote image URL into a Buffer. Some merchant/CDN sources present broken TLS
// chains, so verification is briefly disabled and always restored. Shared by the gallery
// upload route and the bulk product importer (image-URL cell -> S3).
export async function fetchRemoteImage(url: string): Promise<Buffer> {
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  } finally {
    if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
  }
}

// Stage a raw bulk-import workbook so the background worker can read it out-of-request.
// Lands in the tenant's own bucket (resolveBucket) under imports/. Returns the canonical
// key stored on the import_jobs row.
export async function uploadImportFile(buffer: Buffer, fileName: string): Promise<string> {
  const BUCKET_NAME = await resolveBucket()
  const safe = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const key = `imports/${Date.now()}-${safe}`
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${key}`, Body: buffer,
    ContentType: 'application/octet-stream',
  }))
  return key
}

export async function getImportFile(key: string): Promise<Buffer> {
  const BUCKET_NAME = await resolveBucket()
  const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `${KEY_PREFIX}${key}` }))
  const bytes = await res.Body!.transformToByteArray()
  return Buffer.from(bytes)
}
