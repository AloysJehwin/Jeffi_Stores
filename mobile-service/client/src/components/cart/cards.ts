import { toCard } from '../../lib/card'
import type { CardProduct } from '../../types/home'

type Row = Record<string, any>

/** Routes that already return card props pass through; raw product rows go through toCard. */
export function rowsToCards(rows: Row[], gstEnabled: boolean): { card: CardProduct; handlingDays?: number }[] {
  return rows.map(r => ({
    card: (typeof r.displayPrice === 'number' ? r : toCard(r as any, gstEnabled)) as CardProduct,
    handlingDays: typeof r.handlingDays === 'number' ? r.handlingDays : r.handling_days != null ? Number(r.handling_days) : undefined,
  }))
}
