import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import { authenticateAdmin, requireAdminScope } from '@/lib/auth/jwt'
import { actorOf } from '@/lib/admin/draft-locks'
import { deleteBrandRow, discardReply } from '@/lib/admin/discard-rows'

// The brand page's public profile (docs/BRAND_CATEGORY_PLAN.md §3.1) for the app; an admin GET keeps SELECT *.
const PUBLIC_BRAND_COLUMNS = [
  'id', 'name', 'slug', 'description', 'website', 'logo_url', 'logo_dark_url', 'logo_square_url',
  'tagline', 'story', 'brand_type', 'banner_desktop_url', 'banner_mobile_url', 'brand_color',
  'founded_year', 'headquarters', 'country_of_origin', 'social_links', 'catalogue_pdf_url',
  'default_warranty_months', 'default_warranty_type', 'warranty_terms',
  'service_phone', 'service_email', 'service_url', 'return_policy_note', 'seo_content',
].join(', ')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) {
      // Public: an active brand by id or slug, public columns only.
      const brand = await queryOne(
        `SELECT ${PUBLIC_BRAND_COLUMNS} FROM brands WHERE is_active = true AND ${UUID_RE.test(id) ? 'id' : 'slug'} = $1 LIMIT 1`,
        [id]
      )
      if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
      return NextResponse.json({ brand })
    }

    const brand = await queryOne('SELECT * FROM brands WHERE id = $1', [id])
    if (!brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
    }

    return NextResponse.json({ brand })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch brand' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'brands:write')
    if (admin instanceof NextResponse) return admin

    const body = await request.json()
    const { name, slug, description, website, logo_url, is_active } = body

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
    }

    const updated = await queryOne(
      `UPDATE brands SET name = $1, slug = $2, description = $3, website = $4, logo_url = $5, is_active = $6
       WHERE id = $7 RETURNING id`,
      [name, slug, description || null, website || null, logo_url || null, is_active ?? true, id]
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

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await requireAdminScope(request, 'brands:write')
    if (admin instanceof NextResponse) return admin

    return discardReply(await deleteBrandRow(actorOf(admin), id))
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete brand' }, { status: 500 })
  }
}
