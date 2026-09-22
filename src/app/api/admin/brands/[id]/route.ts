import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseBody, zNonEmpty } from '@/lib/validate'

const patchSchema = z
  .object({
    name: zNonEmpty.optional(),
    slug: zNonEmpty.optional(),
  })
  .refine((d) => d.name !== undefined || d.slug !== undefined, {
    message: 'At least one field is required',
  })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'brands:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json()

  // Publish a create-draft: flip is_draft = false (+ is_active) without requiring the full body.
  if (body.is_draft === false && body.name === undefined) {
    await query(
      `UPDATE brands SET is_draft = false, is_active = COALESCE($2::boolean, is_active) WHERE id = $1`,
      [id, typeof body.is_active === 'boolean' ? body.is_active : null]
    )
    revalidatePath('/admin/brands')
    const updated = await queryOne<any>('SELECT * FROM brands WHERE id = $1', [id])
    return NextResponse.json(updated)
  }

  const {
    name, slug, description, website, logo_url, is_active,
    return_allowed, return_window_days, replacement_allowed, replacement_window_days,
  } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const parsed = parseBody(patchSchema, { name: body.name, slug: body.slug })
  if (!parsed.ok) return parsed.response

  const computedSlug = slug?.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const existingBrand = await queryOne<any>('SELECT is_active FROM brands WHERE id = $1', [id])

  await query(
    `UPDATE brands SET
      name = $1, slug = $2, description = $3, website = $4, logo_url = $5, is_active = $6,
      return_allowed = $7, return_window_days = $8, replacement_allowed = $9, replacement_window_days = $10
    WHERE id = $11`,
    [
      name.trim(), computedSlug, description || null, website || null, logo_url || null, !!is_active,
      !!return_allowed, Math.max(1, parseInt(return_window_days) || 7),
      !!replacement_allowed, Math.max(1, parseInt(replacement_window_days) || 7),
      id,
    ]
  )

  if (existingBrand && existingBrand.is_active !== !!is_active) {
    await query('UPDATE products SET is_active = $1 WHERE brand_id = $2', [!!is_active, id])
  }

  revalidatePath('/admin/brands')

  const updated = await queryOne<any>('SELECT * FROM brands WHERE id = $1', [id])

  return NextResponse.json(updated)
}
