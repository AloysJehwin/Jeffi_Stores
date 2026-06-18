import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { suggestIcon } from '@/lib/iconSuggest'
import { revalidatePath } from 'next/cache'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json()
  const {
    name, description, parent_id, display_order, sku_prefix,
    is_active, google_product_category, icon_name,
    return_allowed, return_window_days, replacement_allowed, replacement_window_days,
  } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const skuPrefix = (sku_prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null
  const iconToUse = icon_name?.trim() || await suggestIcon(name.trim())

  const retAllowed   = return_allowed   == null ? null : !!return_allowed
  const retDays      = return_allowed   == null ? null : Math.max(1, parseInt(return_window_days) || 7)
  const replAllowed  = replacement_allowed  == null ? null : !!replacement_allowed
  const replDays     = replacement_allowed  == null ? null : Math.max(1, parseInt(replacement_window_days) || 7)


  const before = await queryOne<any>('SELECT * FROM categories WHERE id = $1', [id])

  await query(
    `UPDATE categories SET
      name = $1, slug = $2, description = $3, parent_category_id = $4,
      sku_prefix = $5, display_order = $6, is_active = $7, google_product_category = $8,
      icon_name = $9, return_allowed = $10, return_window_days = $11,
      replacement_allowed = $12, replacement_window_days = $13, updated_at = $14
    WHERE id = $15`,
    [
      name.trim(), slug, description || null, parent_id || null,
      skuPrefix, parseInt(display_order) || 0, !!is_active, google_product_category || null,
      iconToUse,
      retAllowed, retDays,
      replAllowed, replDays,
      new Date().toISOString(), id,
    ]
  )

  revalidatePath('/admin/categories')

  const updated = await queryOne<any>('SELECT * FROM categories WHERE id = $1', [id])

  return NextResponse.json(updated)
}
