import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'crypto'

function getS3Client() {
  return new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
}

function kycBucket(): string {
  const b = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || process.env.PLATFORM_S3_BUCKET
  if (!b) throw new Error('S3_BUCKET_NAME env var is required for KYC uploads')
  return b
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Where a KYC upload lives: `kyc/{ownerId}/{uuid}.{ext}` (the GST certificate), `kyc/{ownerId}/{docType}/…` for a licence. */
export const kycKeyPrefix = (ownerId: string, docType?: string) => (docType ? `kyc/${ownerId}/${docType}/` : `kyc/${ownerId}/`)

export async function uploadKycDocument(opts: {
  buffer: Buffer
  originalFilename: string
  mimeType: string
  ownerId: string
  /** A compliance document type (lib/catalog/compliance.ts DOCS); none for the GST certificate. */
  docType?: string
}): Promise<string> {
  const ext = EXT[opts.mimeType] ?? (opts.originalFilename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin')
  const key = `${kycKeyPrefix(opts.ownerId, opts.docType)}${randomUUID()}.${ext}`

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: kycBucket(),
      Key: key,
      Body: opts.buffer,
      ContentType: opts.mimeType,
      Metadata: {
        owner_id: opts.ownerId,
        // S3 metadata is ASCII-only.
        original_filename: encodeURIComponent(opts.originalFilename).slice(0, 512),
        ...(opts.docType ? { doc_type: opts.docType } : {}),
      },
    })
  )

  return key
}

/** Fetch KYC document bytes from S3 — used by the admin download route. */
export async function getKycDocumentStream(s3Key: string): Promise<{ body: ReadableStream; contentType: string }> {
  const res = await getS3Client().send(new GetObjectCommand({ Bucket: kycBucket(), Key: s3Key }))
  if (!res.Body) throw new Error('Empty S3 response')
  return {
    body: res.Body.transformToWebStream(),
    contentType: res.ContentType ?? 'application/octet-stream',
  }
}
