import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'

const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Helper function to construct S3 URL from bucket and key
 * This ensures consistent URL format across the application
 */
export function getS3Url(s3Key: string, bucketName: string = BUCKET_NAME, region: string = AWS_REGION): string {
  return `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`
}

/**
 * Helper function to generate S3 keys for product images
 */
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
  s3Key: string
  s3ThumbnailKey: string
  fileName: string
  fileSize: number
  mimeType: string
  width: number
  height: number
}

export async function uploadProductImage(
  file: File,
  productId: string
): Promise<UploadResult> {
  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.')
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File size exceeds 5MB limit.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // Get image metadata and auto-rotate based on EXIF orientation
  const image = sharp(buffer).rotate()
  const metadata = await image.metadata()

  // Generate unique S3 keys using helper function
  const { imageKey: s3Key, thumbnailKey: s3ThumbnailKey } = generateProductImageKeys(productId, file.name)

  // Create thumbnail (300x300) - preserve orientation
  const thumbnailBuffer = await sharp(buffer)
    .rotate() // Auto-rotate based on EXIF orientation
    .resize(300, 300, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toBuffer()

  // Upload original image
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type,
    })
  )

  // Upload thumbnail
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3ThumbnailKey,
      Body: thumbnailBuffer,
      ContentType: 'image/jpeg',
    })
  )

  // Generate URLs using helper function
  const url = getS3Url(s3Key)
  const thumbnailUrl = getS3Url(s3ThumbnailKey)

  return {
    url,
    thumbnailUrl,
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
  const s3Key = `invoices/${financialYear}/${safeFileName}.pdf`

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${safeFileName}.pdf"`,
    })
  )

  return getS3Url(s3Key)
}

export async function deleteProductImage(s3Key: string, s3ThumbnailKey: string) {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
      })
    )

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3ThumbnailKey,
      })
    )
  } catch (error) {
    console.error('Error deleting image from S3:', error)
    throw error
  }
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
      [
        productId,
        image.url,
        image.thumbnailUrl,
        BUCKET_NAME,
        image.s3Key,
        image.s3ThumbnailKey,
        image.fileName,
        image.fileSize,
        image.mimeType,
        image.width,
        image.height,
        image.altText || '',
        i,
        image.isPrimary || i === 0,
      ]
    )
  }
}
