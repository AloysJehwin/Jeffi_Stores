import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

// S3 in prod; a local directory when DOCUMENTS_BUCKET is unset (dev). Keys are tenant-scoped.
const BUCKET = process.env.DOCUMENTS_BUCKET
const LOCAL_DIR = process.env.DOCUMENTS_LOCAL_DIR || path.join(process.cwd(), '.documents')
const s3 = BUCKET ? new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' }) : null

export async function putPdf(key: string, body: Buffer): Promise<void> {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/pdf' }))
    return
  }
  const file = path.join(LOCAL_DIR, key)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
}

export async function getPdf(key: string): Promise<Buffer> {
  if (s3) {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    return Buffer.from(await r.Body!.transformToByteArray())
  }
  return readFile(path.join(LOCAL_DIR, key))
}

/** 1-hour signed URL on S3; the service's own /documents/:id/pdf route in dev. */
export async function pdfUrl(key: string, fallback: string): Promise<string> {
  if (s3) return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 })
  return fallback
}
