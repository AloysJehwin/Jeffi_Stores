import type { AttentionItem } from '@/lib/overview/attention'
import { LEAVES, SOLD_LINES, margin, num } from './catalog'

// Catalogue grouped by category or brand: products, stock value at cost (Inventory overview
// definition), sales and margin in the period vs previous, and empty or unused groups.
// Params: $1/$2 current IST days, $3/$4 previous.

export type GroupDim = 'category' | 'brand'

const COL: Record<GroupDim, string> = { category: 'category_id', brand: 'brand_id' }

export function groupSql(dim: GroupDim) {
  const col = COL[dim]
  const table = dim === 'category' ? 'categories' : 'brands'
  const extra =
    dim === 'category'
      ? `g.parent_category_id::text AS parent_id, (SELECT name FROM categories c2 WHERE c2.id = g.parent_category_id) AS parent_name,
         EXISTS (SELECT 1 FROM categories c3 WHERE c3.parent_category_id = g.id) AS has_children,
         (NULLIF(btrim(COALESCE(g.image_url, '')), '') IS NULL) AS no_image,`
      : `NULL::text AS parent_id, NULL::text AS parent_name, false AS has_children,
         (NULLIF(btrim(COALESCE(g.logo_url, '')), '') IS NULL) AS no_image,`
  return `
  WITH ${SOLD_LINES}, ${LEAVES},
  prod AS (
    SELECT ${col} AS gid, COUNT(*) FILTER (WHERE is_active) AS active, COUNT(*) AS total
    FROM products WHERE NOT is_draft GROUP BY 1
  ),
  stock AS (SELECT ${col} AS gid, SUM(qty * unit_cost) AS value, SUM(qty) AS units FROM leaves GROUP BY 1),
  sales AS (
    SELECT p.${col} AS gid,
           SUM(s.value) FILTER (WHERE s.cur) AS sales, SUM(s.value) FILTER (WHERE NOT s.cur) AS prev_sales,
           SUM(s.quantity) FILTER (WHERE s.cur) AS units,
           SUM(s.net) FILTER (WHERE s.cur AND s.cost IS NOT NULL) AS costed_net, SUM(s.cost) FILTER (WHERE s.cur) AS cost
    FROM sold s JOIN products p ON p.id = s.product_id GROUP BY 1
  ),
  last_sale AS (
    SELECT p.${col} AS gid, MAX(COALESCE(o.invoice_date, o.created_at)) AS at
    FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
    WHERE o.payment_status = 'paid' AND o.status NOT IN ('cancelled', 'returned', 'draft', 'cancel_rejected')
    GROUP BY 1
  )
  SELECT g.id::text AS id, g.name, g.is_active, ${extra}
         COALESCE(pr.active, 0) AS active_products, COALESCE(pr.total, 0) AS products,
         COALESCE(st.value, 0) AS stock_value, COALESCE(st.units, 0) AS stock_units,
         COALESCE(sa.sales, 0) AS sales, COALESCE(sa.prev_sales, 0) AS prev_sales, COALESCE(sa.units, 0) AS units,
         sa.costed_net, sa.cost, ls.at AS last_sale
  FROM ${table} g
  LEFT JOIN prod pr ON pr.gid = g.id
  LEFT JOIN stock st ON st.gid = g.id
  LEFT JOIN sales sa ON sa.gid = g.id
  LEFT JOIN last_sale ls ON ls.gid = g.id
  WHERE NOT g.is_draft
  ORDER BY COALESCE(sa.sales, 0) DESC, COALESCE(st.value, 0) DESC, g.name`
}

/** Active products with no category or brand. */
export const unassignedSql = (dim: GroupDim) =>
  `SELECT COUNT(*) AS n FROM products WHERE is_active AND NOT is_draft AND ${COL[dim]} IS NULL`

export interface GroupRow {
  id: string
  name: string
  isActive: boolean
  parentId: string | null
  parentName: string | null
  hasChildren: boolean
  noImage: boolean
  activeProducts: number
  products: number
  stockValue: number
  stockUnits: number
  sales: number
  prevSales: number
  units: number
  margin: number | null
  lastSale: string | null
}

export function toGroupRow(r: Record<string, unknown>): GroupRow {
  const last = r.last_sale
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    isActive: !!r.is_active,
    parentId: (r.parent_id as string) ?? null,
    parentName: (r.parent_name as string) ?? null,
    hasChildren: !!r.has_children,
    noImage: !!r.no_image,
    activeProducts: num(r.active_products),
    products: num(r.products),
    stockValue: num(r.stock_value),
    stockUnits: num(r.stock_units),
    sales: num(r.sales),
    prevSales: num(r.prev_sales),
    units: num(r.units),
    margin: margin(num(r.costed_net), num(r.cost)),
    lastSale: last == null ? null : last instanceof Date ? last.toISOString() : String(last),
  }
}

export const UNUSED_DAYS = 90

export interface GroupTotals {
  groups: number
  active: number
  products: number
  stockValue: number
  sales: number
  prevSales: number
  empty: number
  unused: number
}

/** Empty: active, no products of its own and (categories) no subcategories. Unused: active products
 * but no sale in UNUSED_DAYS before `now`. */
export function classifyGroups(rows: GroupRow[], now: Date = new Date()) {
  const cutoff = now.getTime() - UNUSED_DAYS * 86_400_000
  const empty = rows.filter(r => r.isActive && r.products === 0 && !r.hasChildren)
  const unused = rows.filter(
    r => r.isActive && r.activeProducts > 0 && (!r.lastSale || Date.parse(r.lastSale) < cutoff)
  )
  const inactiveWithProducts = rows.filter(r => !r.isActive && r.activeProducts > 0)
  const totals: GroupTotals = {
    groups: rows.length,
    active: rows.filter(r => r.isActive).length,
    products: rows.reduce((a, r) => a + r.activeProducts, 0),
    stockValue: rows.reduce((a, r) => a + r.stockValue, 0),
    sales: rows.reduce((a, r) => a + r.sales, 0),
    prevSales: rows.reduce((a, r) => a + r.prevSales, 0),
    empty: empty.length,
    unused: unused.length,
  }
  return { empty, unused, inactiveWithProducts, totals }
}

const names = (rows: { name: string }[]) =>
  rows
    .slice(0, 3)
    .map(r => r.name)
    .join(', ') + (rows.length > 3 ? ` and ${rows.length - 3} more` : '')

export function groupAttention(
  dim: GroupDim,
  c: ReturnType<typeof classifyGroups>,
  rows: GroupRow[],
  unassigned: number
): AttentionItem[] {
  const noun = dim === 'category' ? 'categor' : 'brand'
  const word = (n: number) => (dim === 'category' ? `${noun}${n === 1 ? 'y' : 'ies'}` : `${noun}${n === 1 ? '' : 's'}`)
  const base = dim === 'category' ? '/admin/categories' : '/admin/brands'
  const out: AttentionItem[] = []
  if (c.inactiveWithProducts.length)
    out.push({
      key: 'inactive_with_products',
      severity: 'warning',
      title: `${c.inactiveWithProducts.length} inactive ${word(c.inactiveWithProducts.length)} still holding active products`,
      sub: names(c.inactiveWithProducts),
      href: `${base}?is_active=false`,
    })
  if (unassigned)
    out.push({
      key: 'unassigned',
      severity: 'warning',
      title: `${unassigned} active product${unassigned === 1 ? '' : 's'} with no ${dim}`,
      href: '/admin/products?tab=list',
    })
  if (c.empty.length)
    out.push({
      key: 'empty',
      severity: 'info',
      title: `${c.empty.length} active ${word(c.empty.length)} with no products`,
      sub: names(c.empty),
      href: `${base}?is_active=true`,
    })
  if (c.unused.length)
    out.push({
      key: 'unused',
      severity: 'info',
      title: `${c.unused.length} ${word(c.unused.length)} with no sale in ${UNUSED_DAYS} days`,
      sub: names([...c.unused].sort((a, b) => b.stockValue - a.stockValue)),
    })
  const noImage = rows.filter(r => r.isActive && r.noImage && r.activeProducts > 0)
  if (noImage.length)
    out.push({
      key: 'no_image',
      severity: 'info',
      title: `${noImage.length} ${word(noImage.length)} with products but no ${dim === 'category' ? 'image' : 'logo'}`,
      sub: names(noImage),
    })
  return out
}

export const CATEGORIES_SQL = groupSql('category')
export const UNCATEGORISED_SQL = unassignedSql('category')
