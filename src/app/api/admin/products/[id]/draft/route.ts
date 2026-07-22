import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const product = await queryOne<{ id: string; name: string; sku: string }>(
      `SELECT id, name, sku FROM products WHERE id = $1 AND is_active = true`,
      [id]
    )
    if (!product) {
      return NextResponse.json({ error: 'Product not found or not a live product' }, { status: 404 })
    }

    const existingDraft = await queryOne<{ product_id: string }>(
      `SELECT product_id FROM product_drafts WHERE product_id = $1`,
      [id]
    )
    if (existingDraft) {
      return NextResponse.json(
        { error: 'A draft already exists for this product', productId: existingDraft.product_id },
        { status: 409 }
      )
    }

    await query(
      `INSERT INTO product_drafts (product_id, fields, variants, images, sub_variants, units)
       SELECT
         p.id,
         to_jsonb(p) - 'id' - 'created_at' - 'updated_at' - 'search_vector' - 'views_count' - 'sales_count',
         COALESCE((SELECT json_agg(to_jsonb(v) - 'id') FROM product_variants v WHERE v.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(i) - 'id' ORDER BY i.display_order) FROM product_images i WHERE i.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(sv) - 'id') FROM product_sub_variants sv WHERE sv.product_id = p.id), '[]'),
         COALESCE((SELECT json_agg(to_jsonb(u) - 'id') FROM product_units u WHERE u.product_id = p.id), '[]')
       FROM products p WHERE p.id = $1`,
      [id]
    )

    return NextResponse.json({ success: true, productId: id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to create draft' }, { status: 500 })
  }
}
