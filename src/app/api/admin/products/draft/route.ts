import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'

const createDraftSchema = z.object({
  name: zNonEmpty,
})

export async function POST(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'products:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const rawBody = await request.json()

    const parsed = parseBody(createDraftSchema, rawBody)
    if (!parsed.ok) return parsed.response

    const { name } = rawBody
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

    const trimmed = name.trim()
    const slug =
      trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      Date.now().toString(36)
    // Temporary SKU — will be replaced when the admin saves with brand/category selected
    const nameSlug = trimmed
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 16)
    const sku = (nameSlug || 'DRAFT') + '-' + Date.now().toString(36).toUpperCase().slice(-4)

    const product = await queryOne<{ id: string }>(
      `INSERT INTO products (name, slug, sku, base_price, mrp, gst_percentage, is_active, is_featured, has_variants)
       VALUES ($1, $2, $3, 0, 0, 18, false, false, false)
       RETURNING id`,
      [trimmed, slug, sku]
    )

    if (!product) throw new Error('Insert failed')

    return NextResponse.json({ id: product.id, name: trimmed, sku })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 500 })
  }
}
