import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const brands = await queryMany('SELECT * FROM brands ORDER BY name ASC')
    return NextResponse.json({ brands })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch brands' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, slug, description, website, logo_url, is_active } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
    }

    const brand = await query(
      `INSERT INTO brands (name, slug, description, website, logo_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, slug, description || null, website || null, logo_url || null, is_active ?? true]
    )

    return NextResponse.json({ success: true, id: brand.rows[0].id })
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A brand with this name or slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message || 'Failed to create brand' }, { status: 500 })
  }
}
