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

export async function uploadKycDocument(opts: {
  buffer: Buffer
  originalFilename: string
  mimeType: string
  ownerId: string
}): Promise<string> {
  const ext = opts.originalFilename.split('.').pop()?.toLowerCase() || 'bin'
  const key = `kyc/${opts.ownerId}/${randomUUID()}.${ext}`

  await getS3Client().send(new PutObjectCommand({
    Bucket: kycBucket(),
    Key: key,
    Body: opts.buffer,
    ContentType: opts.mimeType,
    Metadata: {
      owner_id: opts.ownerId,
      original_filename: opts.originalFilename,
    },
  }))

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
