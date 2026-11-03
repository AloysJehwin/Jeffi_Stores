// Reorder rule shared by the inventory and purchase-order overviews.

export const MIN_COVER_DAYS = 14
export const DEFAULT_LEAD_DAYS = 7
export const SAFETY_DAYS = 30

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

export interface ReorderInput {
  qty: unknown
  sold: unknown
  lead_time_days?: unknown
  moq?: unknown
  purchase_unit_factor?: unknown
}

export interface ReorderAdvice {
  avgDaily: number
  daysOfCover: number
  thresholdDays: number
  leadTimeDays: number | null
  suggestedQty: number
}

// Days of cover = on hand / average daily net sales. Flag when it is below max(lead time, 14 days);
// suggest enough to cover the threshold plus a 30-day buffer, rounded up to the supplier MOQ.
export function reorderAdvice(row: ReorderInput, days: number): ReorderAdvice | null {
  const sold = num(row.sold)
  if (sold <= 0 || days <= 0) return null
  const onHand = Math.max(0, num(row.qty))
  const avgDaily = sold / days
  const daysOfCover = onHand / avgDaily
  const lead = row.lead_time_days == null || row.lead_time_days === '' ? null : num(row.lead_time_days)
  const thresholdDays = Math.max(lead ?? 0, MIN_COVER_DAYS)
  if (daysOfCover >= thresholdDays) return null
  const target = Math.max(lead ?? DEFAULT_LEAD_DAYS, MIN_COVER_DAYS) + SAFETY_DAYS
  let suggestedQty = Math.max(1, Math.ceil(avgDaily * target - onHand))
  const moqBase = num(row.moq) * (num(row.purchase_unit_factor) || 1)
  if (moqBase > 0 && suggestedQty < moqBase) suggestedQty = Math.ceil(moqBase)
  return { avgDaily, daysOfCover, thresholdDays, leadTimeDays: lead, suggestedQty }
}

export function buildReorder<T extends ReorderInput>(rows: T[], days: number, limit = 25): (T & ReorderAdvice)[] {
  const out: (T & ReorderAdvice)[] = []
  for (const r of rows) {
    const a = reorderAdvice(r, days)
    if (a) out.push({ ...r, ...a })
  }
  return out.sort((a, b) => a.daysOfCover - b.daysOfCover || b.avgDaily - a.avgDaily).slice(0, limit)
}
