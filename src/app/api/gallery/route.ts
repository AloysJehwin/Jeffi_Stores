import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, queryOne } from '@/lib/db'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))
  const offset = (page - 1) * limit
  const categoryId = searchParams.get('category') || null

  const whereClause = categoryId ? 'WHERE category_id = $3' : ''
  const params = categoryId ? [limit, offset, categoryId] : [limit, offset]

  const images = await queryMany(
    `SELECT gi.*, c.name AS category_name FROM gallery_images gi
     LEFT JOIN categories c ON c.id = gi.category_id
     ${whereClause}
     ORDER BY gi.created_at DESC LIMIT $1 OFFSET $2`,
    params
  )

  const countParams = categoryId ? [categoryId] : []
  const countRow = await queryOne(
    `SELECT COUNT(*) AS total FROM gallery_images${categoryId ? ' WHERE category_id = $1' : ''}`,
    countParams
  )

  return NextResponse.json({ images: images || [], total: parseInt(countRow?.total || '0'), page, limit })
}
