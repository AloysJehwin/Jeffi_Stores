import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'
import { getS3Url } from '@/lib/s3'

// Resolve a gallery image URL. Prefer the S3 key (which getS3Url prefixes with the
// current env's S3_KEY_PREFIX, e.g. dev/) so dev + prod URLs match where the object
// physically lives; fall back to the stored absolute URL when no key is present.
function galleryImageUrl(s3Key: string | null, fallback: string | null): string | null {
  if (s3Key) return getS3Url(s3Key)
  return fallback
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))
  const offset = (page - 1) * limit
  const categoryId = searchParams.get('category') || null
  const search = (searchParams.get('search') || '').trim()

  // Build WHERE conditions dynamically so category + search compose. Filter params
  // are shared between the list query and the count query; the list query appends
  // limit/offset as the last two positional params.
  const conditions: string[] = []
  const filterParams: any[] = []
  if (categoryId) { filterParams.push(categoryId); conditions.push(`gi.category_id = $${filterParams.length}`) }
  if (search) { filterParams.push(`%${search}%`); const n = filterParams.length; conditions.push(`(gi.custom_name ILIKE $${n} OR gi.file_name ILIKE $${n})`) }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const images = await queryMany(
    `SELECT gi.*, c.name AS category_name FROM gallery_images gi
     LEFT JOIN categories c ON c.id = gi.category_id
     ${whereClause}
     ORDER BY gi.created_at DESC LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
    [...filterParams, limit, offset]
  )

  const countRow = await queryOne(
    `SELECT COUNT(*) AS total FROM gallery_images gi${whereClause ? ` ${whereClause}` : ''}`,
    filterParams
  )

  const normalized = (images || []).map((img: any) => ({
    ...img,
    image_url: galleryImageUrl(img.s3_key, img.image_url),
    thumbnail_url: galleryImageUrl(img.s3_thumbnail_key, img.thumbnail_url),
  }))

  return NextResponse.json({ images: normalized, total: parseInt(countRow?.total || '0'), page, limit })
}
