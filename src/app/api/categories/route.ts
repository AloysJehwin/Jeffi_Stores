import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany } from '@/lib/db'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const categories = await queryMany(
    'SELECT id, name, slug FROM categories WHERE is_active = true ORDER BY display_order ASC, name ASC',
    []
  )

  return NextResponse.json({ categories: categories || [] })
}
