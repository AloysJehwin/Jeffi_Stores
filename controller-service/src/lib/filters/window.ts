import { paramNamesOf, type FilterEntity, type FilterQuery } from '@jeffi/list-filters'
import { addDays, istToday } from '@/lib/overview/period'

/**
 * High-volume lists (defaultWindowDays) read only their last N days when no date is given, as their
 * list routes do; value help and exports should too. Returns a new query.
 */
export function withDefaultWindow(entity: FilterEntity, q: FilterQuery, today = istToday()): FilterQuery {
  const days = entity.defaultWindowDays
  const field = entity.period ? entity.fields.find(f => f.key === entity.period) : undefined
  if (!days || !field) return q
  const [from, to] = paramNamesOf(field)
  if (q[from] || (to && q[to])) return q
  return { ...q, [from]: addDays(today, 1 - days) }
}
