import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser as authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
})

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
const KEY_PREFIX = process.env.S3_KEY_PREFIX ? `${process.env.S3_KEY_PREFIX}/` : ''
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL?.replace(/\/$/, '') ?? ''
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024

function getS3Url(key: string) {
  const fullKey = KEY_PREFIX ? `${KEY_PREFIX}${key}` : key
  if (CLOUDFRONT_URL) return `${CLOUDFRONT_URL}/${fullKey}`
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fullKey}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const authUser = await authenticateUser(request)
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const order = await queryOne(
      `SELECT id FROM orders WHERE id = $1 AND user_id = $2 AND status = 'delivered'`,
      [id, authUser.userId]
    )
    if (!order) return NextResponse.json({ error: 'Order not found or not eligible' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Invalid file type. JPEG, PNG, WebP only.' }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File exceeds 5MB limit.' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const s3Key = `returns/${id}/${timestamp}-${sanitizedName}`

    const resized = await sharp(buffer)
      .rotate()
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()

    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${KEY_PREFIX}${s3Key}`,
      Body: resized,
      ContentType: 'image/jpeg',
    }))

    return NextResponse.json({ url: getS3Url(s3Key) })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Upload failed' }, { status: 500 })
  }
}
