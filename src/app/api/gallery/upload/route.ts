import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { uploadGalleryImage } from '@/lib/s3'
import { queryOne } from '@/lib/db'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    let imageBuffer: Buffer
    let fileName = 'image'
    let sourceUrl: string | null = null
    let customName: string | null = null
    let categoryId: string | null = null

    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const body = await request.json()
      if (!body.imageUrl) return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 })
      sourceUrl = body.imageUrl
      customName = body.customName || null
      categoryId = body.categoryId || null
      fileName = body.fileName || new URL(body.imageUrl).pathname.split('/').pop() || 'image'
      const res = await fetch(body.imageUrl)
      if (!res.ok) return NextResponse.json({ error: 'Failed to fetch image' }, { status: 400 })
      imageBuffer = Buffer.from(await res.arrayBuffer())
    } else {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      fileName = file.name
      customName = (formData.get('customName') as string | null) || null
      categoryId = (formData.get('categoryId') as string | null) || null
      imageBuffer = Buffer.from(await file.arrayBuffer())
    }

    const result = await uploadGalleryImage(imageBuffer, fileName)

    const record = await queryOne(
      `INSERT INTO gallery_images (image_url, thumbnail_url, s3_key, s3_thumbnail_key, s3_bucket, file_name, file_size, mime_type, width, height, source_url, custom_name, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [result.url, result.thumbnailUrl, result.s3Key, result.s3ThumbnailKey,
       process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket',
       result.fileName, result.fileSize, 'image/png', result.width, result.height, sourceUrl, customName, categoryId]
    )

    return NextResponse.json(record)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
  }
}
