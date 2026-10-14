import { queryOne, queryMany } from '@/lib/shared/db'
export { applyDiscount as applyBusinessDiscount, applyDiscount } from '@/lib/catalog/pricing'

export async function getBusinessDiscountPct(userId: string, categoryId: string): Promise<number> {
  const row = await queryOne<{ discount_pct: string }>(
    `SELECT discount_pct FROM business_discounts WHERE user_id=$1 AND category_id=$2`,
    [userId, categoryId]
  )
  return row ? parseFloat(row.discount_pct) : 0
}

export async function getBusinessDiscountMap(userId: string): Promise<Record<string, number>> {
  const rows = await queryMany<{ category_id: string; discount_pct: string }>(
    `SELECT category_id, discount_pct FROM business_discounts WHERE user_id=$1`,
    [userId]
  )
  return Object.fromEntries(rows.map(r => [r.category_id, parseFloat(r.discount_pct)]))
}
