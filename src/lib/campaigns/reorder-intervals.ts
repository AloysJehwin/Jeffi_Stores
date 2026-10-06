import { z } from 'zod'
import { query, queryMany } from '@/lib/shared/db'

// How often a consumable category is typically reordered, for the Replenishment campaign. Empty means
// "not a consumable": nobody who bought from that category is reminded. A subcategory with no value of
// its own uses its parent's.

export const MAX_REORDER_DAYS = 365

export interface ReorderIntervalRow {
  categoryId: string
  name: string
  parentId: string | null
  parentName: string | null
  products: number
  days: number | null
}

export const ReorderIntervalsInputSchema = z.object({
  intervals: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        days: z.number().int().min(1).max(MAX_REORDER_DAYS).nullable(),
      })
    )
    .max(2000),
})
export type ReorderIntervalsInput = z.infer<typeof ReorderIntervalsInputSchema>

export async function listReorderIntervals(): Promise<ReorderIntervalRow[]> {
  const rows = await queryMany<{
    id: string
    name: string
    parent_id: string | null
    parent_name: string | null
    products: number
    reorder_interval_days: number | null
  }>(
    `SELECT c.id::text, c.name, c.parent_category_id::text AS parent_id, pc.name AS parent_name,
            -- Including subcategories, since a parent's interval covers them too.
            (SELECT COUNT(*)::int FROM products p JOIN categories pcat ON pcat.id = p.category_id
              WHERE p.is_active AND (pcat.id = c.id OR pcat.parent_category_id = c.id)) AS products,
            c.reorder_interval_days
       FROM categories c
       LEFT JOIN categories pc ON pc.id = c.parent_category_id
      WHERE c.is_draft = FALSE
      ORDER BY COALESCE(pc.name, c.name), c.parent_category_id IS NOT NULL, c.name`
  )
  return rows.map(row => ({
    categoryId: row.id,
    name: row.name,
    parentId: row.parent_id,
    parentName: row.parent_name,
    products: row.products,
    days: row.reorder_interval_days,
  }))
}

export async function saveReorderIntervals(input: ReorderIntervalsInput): Promise<number> {
  if (input.intervals.length === 0) return 0
  const result = await query(
    `UPDATE categories c
        SET reorder_interval_days = t.days, updated_at = NOW()
       FROM UNNEST($1::uuid[], $2::int[]) AS t(id, days)
      WHERE c.id = t.id
        AND c.reorder_interval_days IS DISTINCT FROM t.days`,
    [input.intervals.map(i => i.categoryId), input.intervals.map(i => i.days)]
  )
  return result.rowCount ?? 0
}
