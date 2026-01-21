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
  const { supabaseAdmin } = await import('./supabase')

  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    await supabaseAdmin.from('product_images').insert({
      product_id: productId,
      image_url: image.url,
      thumbnail_url: image.thumbnailUrl,
      s3_bucket: BUCKET_NAME,
      s3_key: image.s3Key,
      s3_thumbnail_key: image.s3ThumbnailKey,
      file_name: image.fileName,
      file_size: image.fileSize,
      mime_type: image.mimeType,
      width: image.width,
      height: image.height,
      alt_text: image.altText || '',
      display_order: i,
      is_primary: image.isPrimary || i === 0,
    })
  }
}
