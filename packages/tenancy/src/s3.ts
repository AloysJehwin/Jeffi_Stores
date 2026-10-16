import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'
import { currentTenant } from './context'

const REGION = process.env.AWS_REGION || 'us-east-1'
const DEFAULT_BUCKET = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
const KEY_PREFIX = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : ''
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL?.replace(/\/$/, '') ?? ''

let client: S3Client | null = null
const s3 = () =>
  (client ??= new S3Client({
    region: REGION,
    ...(process.env.AWS_ACCESS_KEY_ID ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '' } } : {}),
  }))

export function currentBucket(): string {
  return currentTenant()?.infra?.s3Bucket || DEFAULT_BUCKET
}

export function publicUrl(bucket: string, fullKey: string): string {
  if (bucket === DEFAULT_BUCKET && CLOUDFRONT_URL) return `${CLOUDFRONT_URL}/${fullKey}`
  return `https://${bucket}.s3.${REGION}.amazonaws.com/${fullKey}`
}

export function getS3Url(key: string): string {
  return publicUrl(currentBucket(), `${KEY_PREFIX}${key}`)
}

export async function uploadInvoicePDF(pdf: Buffer, invoiceNumber: string, financialYear: string): Promise<string> {
  const safe = invoiceNumber.replace(/\//g, '-')
  const key = `invoices/${financialYear}/${safe}.pdf`
  await s3().send(
    new PutObjectCommand({
      Bucket: currentBucket(),
      Key: `${KEY_PREFIX}${key}`,
      Body: pdf,
      ContentType: 'application/pdf',
      ContentDisposition: `inline; filename="${safe}.pdf"`,
    })
  )
  return getS3Url(key)
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'application/pdf': 'pdf',
}

// The flagship CDN in front of the default bucket; approved WhatsApp header prefixes point at it.
export const MEDIA_CDN_URL = (process.env.MEDIA_CDN_URL || CLOUDFRONT_URL || 'https://dm9rri2wgl1e.cloudfront.net').replace(/\/$/, '')

/** Puts the file in the CDN's bucket under `base` (a URL on MEDIA_CDN_URL) and returns its CDN link, whatever
 *  the tenant's own bucket or this pod's CLOUDFRONT_URL is. */
export async function uploadCdnAsset(buf: Buffer, mime: string, base = `${MEDIA_CDN_URL}/`): Promise<{ key: string; url: string }> {
  const u = new URL(base)
  if (u.origin !== new URL(MEDIA_CDN_URL).origin) throw new Error(`${u.origin} is not our media CDN`)
  const dir = u.pathname.replace(/^\//, '') || KEY_PREFIX
  const key = `${dir}template-assets/media/${randomUUID()}.${EXT_BY_MIME[mime] || 'bin'}`
  await s3().send(new PutObjectCommand({ Bucket: DEFAULT_BUCKET, Key: key, Body: buf, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }))
  return { key, url: `${u.origin}/${key}` }
}

export async function uploadTemplateAsset(
  buf: Buffer, templateId: string | null, mime: string
): Promise<{ key: string; url: string }> {
  const ext = EXT_BY_MIME[mime] || 'bin'
  const key = `template-assets/${templateId ?? 'library'}/${randomUUID()}.${ext}`
  await s3().send(new PutObjectCommand({
    Bucket: currentBucket(),
    Key: `${KEY_PREFIX}${key}`,
    Body: buf,
    ContentType: mime,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return { key, url: getS3Url(key) }
}
