import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, query, withTransaction } from '@/lib/db'
import type { PoolClient } from 'pg'

export const dynamic = 'force-dynamic'
interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const draft = await queryOne<{ category_id: string; fields: Record<string, unknown> }>(
    `SELECT category_id, fields FROM category_drafts WHERE category_id = $1`, [id]
  )
  if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 404 })

  const f = draft.fields as any
  const prevIsActive = await queryOne<{ is_active: boolean }>(
    `SELECT is_active FROM categories WHERE id = $1`, [id]
  )

  try {
    await withTransaction(async (client: PoolClient) => {
      const slug = f.name
        ? f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : null

      await client.query(
        `UPDATE categories SET
           name = COALESCE($2, name),
           slug = COALESCE($3, slug),
           description = $4,
           parent_category_id = $5::uuid,
           display_order = COALESCE($6, display_order),
           sku_prefix = $7,
           is_active = COALESCE($8::boolean, is_active),
           policy_override = COALESCE($9::boolean, policy_override),
           return_allowed = $10::boolean,
           return_window_days = $11::integer,
           replacement_allowed = $12::boolean,
           replacement_window_days = $13::integer,
           google_product_category = $14,
           icon_name = $15,
           updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          f.name || null,
          slug,
          f.description ?? null,
          f.parent_category_id || null,
          f.display_order != null ? parseInt(f.display_order) : null,
          f.sku_prefix || null,
          f.is_active != null ? f.is_active : null,
          f.policy_override != null ? f.policy_override : null,
          f.return_allowed != null ? f.return_allowed : null,
          f.return_window_days != null ? parseInt(f.return_window_days) : null,
          f.replacement_allowed != null ? f.replacement_allowed : null,
          f.replacement_window_days != null ? parseInt(f.replacement_window_days) : null,
          f.google_product_category || null,
          f.icon_name || null,
        ]
      )

      // Cascade is_active change to products and subcategories
      if (f.is_active != null && f.is_active !== prevIsActive?.is_active) {
        await client.query(
          `UPDATE products SET is_active = $1 WHERE category_id = $2`,
          [f.is_active, id]
        )
        const subcats = await client.query<{ id: string }>(
          `SELECT id FROM categories WHERE parent_category_id = $1`, [id]
        )
        for (const sub of subcats.rows) {
          await client.query(
            `UPDATE categories SET is_active = $1, updated_at = NOW() WHERE id = $2`,
            [f.is_active, sub.id]
          )
          await client.query(
            `UPDATE products SET is_active = $1 WHERE category_id = $2`,
            [f.is_active, sub.id]
          )
        }
      }

      await client.query(`DELETE FROM category_drafts WHERE category_id = $1`, [id])
    })

    return NextResponse.json({ success: true, categoryId: id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to publish' }, { status: 500 })
  }
}
