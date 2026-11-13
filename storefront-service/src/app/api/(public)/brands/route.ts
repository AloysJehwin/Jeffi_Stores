import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/shared/db'
import { requireAdminScope } from '@/lib/auth/jwt'
import { listBrandsWithCounts } from '@/lib/catalog/storefront-counts'
import { applyBrandProfile } from '@/lib/catalog/brand-draft'
import { BRAND_PROFILE_FIELDS } from '@/lib/catalog/brand-fields'
import { parseBodyFields } from '@/lib/catalog/entity-fields'

export async function GET(request: NextRequest) {
  try {
    // ?counts=1: the /brands page's rows (description, logo, active product count) for the app.
    if (new URL(request.url).searchParams.get('counts') === '1') {
      const rows = await listBrandsWithCounts()
      return NextResponse.json({ brands: rows.map(b => ({ ...b, product_count: parseInt(b.product_count, 10) || 0 })) })
    }
    const brands = await queryMany('SELECT id, name, slug FROM brands WHERE is_active = true ORDER BY name ASC', [])
    return NextResponse.json({ brands: brands || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch brands' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminScope(request, 'brands:write')
    if (admin instanceof NextResponse) return admin

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
    // Profile columns (brand-fields.ts) when the body carries any.
    await applyBrandProfile({ query: (t: string, p?: unknown[]) => query(t, p) } as any, brand.rows[0].id, parseBodyFields(BRAND_PROFILE_FIELDS, body))

    return NextResponse.json({ success: true, id: brand.rows[0].id })
  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A brand with this name or slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message || 'Failed to create brand' }, { status: 500 })
  }
}
