import { buildWhere, type FilterQuery } from '@jeffi/list-filters'
import { queryMany, queryOne } from './shared'
import { CATEGORIES_ENTITY } from '@/lib/filters/entities/categories'

/** Live categories the filters match, plus the parents of matching subcategories (matched = false) so the tree renders. */
export async function queryCategoryTree(q: FilterQuery) {
  const w = buildWhere(CATEGORIES_ENTITY, q)
  return queryMany(
    `WITH m AS (SELECT c.id FROM categories c ${w.where})
     SELECT c.*, c.id IN (SELECT id FROM m) AS matched
     FROM categories c
     WHERE c.id IN (SELECT id FROM m)
        OR c.id IN (SELECT x.parent_category_id FROM categories x WHERE x.id IN (SELECT id FROM m))
     ORDER BY c.display_order ASC`,
    w.params
  )
}

/** The list's KPIs over every matching category. */
export async function getCategoriesSummary(q: FilterQuery) {
  const w = buildWhere(CATEGORIES_ENTITY, q)
  const r = await queryOne<{ total: number; main: number }>(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE c.parent_category_id IS NULL)::int AS main
     FROM categories c ${w.where}`,
    w.params
  )
  return { total: r?.total ?? 0, main: r?.main ?? 0 }
}
