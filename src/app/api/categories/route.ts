import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

export async function GET(_request: NextRequest) {

  const categories = await queryMany(
    'SELECT id, name, slug FROM categories WHERE is_active = true ORDER BY display_order ASC, name ASC',
    []
  )

  return NextResponse.json({ categories: categories || [] })
}
