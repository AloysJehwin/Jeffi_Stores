import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne, queryCount } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const brand = await queryOne('SELECT * FROM brands WHERE id = $1', [params.id])
    if (!brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    }

    return NextResponse.json({ brand })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch brand' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const updated = await queryOne(
      `UPDATE brands SET name = $1, slug = $2, description = $3, website = $4, logo_url = $5, is_active = $6
       WHERE id = $7 RETURNING id`,
      [name, slug, description || null, website || null, logo_url || null, is_active ?? true, params.id]
    )

    if (!updated) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A brand with this name or slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message || 'Failed to update brand' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const brandId = params.id

    const productCount = await queryCount(
      'SELECT COUNT(*) FROM products WHERE brand_id = $1',
      [brandId]
    )

    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete brand. It has ${productCount} product(s) assigned to it.` },
        { status: 400 }
      )
    }

    await query('DELETE FROM brands WHERE id = $1', [brandId])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to delete brand' },
      { status: 500 }
    )
  }
}
