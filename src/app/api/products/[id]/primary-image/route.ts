import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const image = await queryOne(
    `SELECT COALESCE(thumbnail_url, image_url) AS image_url
     FROM product_images
     WHERE product_id = $1
     ORDER BY is_primary DESC, display_order ASC
     LIMIT 1`,
    [params.id]
  )
  return NextResponse.json({ imageUrl: image?.image_url ?? null })
}
