import { query, queryOne, withTransaction } from '@/lib/db'
import type { PoolClient } from 'pg'

export async function publishCategoryDraft(categoryId: string): Promise<void> {
  const draft = await queryOne<{ category_id: string; fields: Record<string, unknown> }>(
    `SELECT category_id, fields FROM category_drafts WHERE category_id = $1`, [categoryId]
  )
  if (!draft) throw new Error('No draft to publish')

  const f = draft.fields as any
  const prevIsActive = await queryOne<{ is_active: boolean }>(
    `SELECT is_active FROM categories WHERE id = $1`, [categoryId]
  )
  const slug = f.name
    ? f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : null

  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `UPDATE categories SET
         name = COALESCE($2, name), slug = COALESCE($3, slug),
         description = $4, parent_category_id = $5::uuid,
         display_order = COALESCE($6, display_order), sku_prefix = $7,
         is_active = COALESCE($8::boolean, is_active),
         policy_override = COALESCE($9::boolean, policy_override),
         return_allowed = $10::boolean, return_window_days = $11::integer,
         replacement_allowed = $12::boolean, replacement_window_days = $13::integer,
         google_product_category = $14, icon_name = $15, updated_at = NOW()
       WHERE id = $1`,
      [
        categoryId, f.name || null, slug, f.description ?? null,
        f.parent_category_id || null,
        f.display_order != null ? parseInt(f.display_order) : null,
        f.sku_prefix || null,
        f.is_active != null ? f.is_active : null,
        f.policy_override != null ? f.policy_override : null,
        f.return_allowed != null ? f.return_allowed : null,
        f.return_window_days != null ? parseInt(f.return_window_days) : null,
        f.replacement_allowed != null ? f.replacement_allowed : null,
        f.replacement_window_days != null ? parseInt(f.replacement_window_days) : null,
        f.google_product_category || null, f.icon_name || null,
      ]
    )

    // Cascade is_active if changed
    if (f.is_active != null && f.is_active !== prevIsActive?.is_active) {
      await client.query(
        `UPDATE products SET is_active = $1 WHERE category_id = $2`, [f.is_active, categoryId]
      )
      const subcats = await client.query<{ id: string }>(
        `SELECT id FROM categories WHERE parent_category_id = $1`, [categoryId]
      )
      for (const sub of subcats.rows) {
        await client.query(
          `UPDATE categories SET is_active = $1, updated_at = NOW() WHERE id = $2`, [f.is_active, sub.id]
        )
        await client.query(
          `UPDATE products SET is_active = $1 WHERE category_id = $2`, [f.is_active, sub.id]
        )
      }
    }

    await client.query(`DELETE FROM category_drafts WHERE category_id = $1`, [categoryId])
  })
}
