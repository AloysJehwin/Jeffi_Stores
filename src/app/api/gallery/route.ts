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

  const images = await queryMany(
    'SELECT * FROM gallery_images ORDER BY created_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  )
  const countRow = await queryOne('SELECT COUNT(*) AS total FROM gallery_images', [])
  const total = parseInt(countRow?.total || '0')

  return NextResponse.json({ images: images || [], total, page, limit })
}
