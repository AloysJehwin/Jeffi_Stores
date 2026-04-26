import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
const KEY_PREFIX = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : ''

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function getS3Url(s3Key: string, bucketName: string = BUCKET_NAME, region: string = AWS_REGION): string {
  return `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`
}

export function generateProductImageKeys(productId: string, fileName: string) {
  const timestamp = Date.now()
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  return {
    imageKey: `${KEY_PREFIX}products/${productId}/${timestamp}-${sanitizedName}`,
    thumbnailKey: `${KEY_PREFIX}products/${productId}/thumbnails/${timestamp}-${sanitizedName}`,
  }
}

export interface UploadResult {
  url: string
  thumbnailUrl: string
  s3Key: string
  s3ThumbnailKey: string
  fileName: string
  fileSize: number
  mimeType: string
  width: number
  height: number
}

export async function uploadProductImage(file: File, productId: string): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size exceeds 5MB limit.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const image = sharp(buffer).rotate()
  const metadata = await image.metadata()
  const { imageKey: s3Key, thumbnailKey: s3ThumbnailKey } = generateProductImageKeys(productId, file.name)

  const thumbnailBuffer = await sharp(buffer).rotate().resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()

  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key, Body: buffer, ContentType: file.type }))
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3ThumbnailKey, Body: thumbnailBuffer, ContentType: 'image/jpeg' }))

  return {
    url: getS3Url(s3Key),
    thumbnailUrl: getS3Url(s3ThumbnailKey),
    s3Key,
    s3ThumbnailKey,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

export async function uploadInvoicePDF(pdfBuffer: Buffer, invoiceNumber: string, financialYear: string): Promise<string> {
  const safeFileName = invoiceNumber.replace(/\//g, '-')
  const s3Key = `${KEY_PREFIX}invoices/${financialYear}/${safeFileName}.pdf`
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    ContentDisposition: `inline; filename="${safeFileName}.pdf"`,
  }))
  return getS3Url(s3Key)
}

export async function deleteProductImage(s3Key: string, s3ThumbnailKey: string) {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }))
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3ThumbnailKey }))
}

export async function saveProductImages(
  productId: string,
  images: { url: string; thumbnailUrl: string; s3Key: string; s3ThumbnailKey: string; fileName: string; fileSize: number; mimeType: string; width: number; height: number; altText?: string; isPrimary?: boolean }[]
) {
  const { query } = await import('./db')
  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    await query(
      `INSERT INTO product_images (product_id, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, file_size, mime_type, width, height, alt_text, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [productId, image.url, image.thumbnailUrl, BUCKET_NAME, image.s3Key, image.s3ThumbnailKey, image.fileName, image.fileSize, image.mimeType, image.width, image.height, image.altText || '', i, image.isPrimary || i === 0]
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
}

export async function uploadGalleryImage(imageBuffer: Buffer, fileName: string): Promise<GalleryUploadResult> {
  const timestamp = Date.now()
  const baseName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '')
  const s3Key = `${KEY_PREFIX}gallery/${timestamp}-${baseName}.png`
  const s3ThumbnailKey = `${KEY_PREFIX}gallery/thumbnails/${timestamp}-${baseName}.png`

  const metadata = await sharp(imageBuffer).rotate().metadata()
  const pngBuffer = await sharp(imageBuffer).rotate().png({ compressionLevel: 8 }).toBuffer()
  const thumbnailBuffer = await sharp(imageBuffer).rotate().resize(300, 300, { fit: 'cover' }).png({ compressionLevel: 8 }).toBuffer()

  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key, Body: pngBuffer, ContentType: 'image/png' }))
  await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: s3ThumbnailKey, Body: thumbnailBuffer, ContentType: 'image/png' }))

  return {
    url: getS3Url(s3Key),
    thumbnailUrl: getS3Url(s3ThumbnailKey),
    s3Key,
    s3ThumbnailKey,
    fileName: `${baseName}.png`,
    fileSize: pngBuffer.length,
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

export async function deleteGalleryImage(s3Key: string, s3ThumbnailKey: string) {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }))
  if (s3ThumbnailKey) {
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3ThumbnailKey }))
  }
}
