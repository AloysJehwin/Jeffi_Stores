// Shared TS contract every finance overview API should return. Not an API runtime — just a type
// so each tab client narrows the response once and the API routes build against the same shape.

import type { TrendPoint } from '@/components/admin/kit/charts'

export type FinanceRange = { from: string; to: string }
export type FinanceBucket = 'day' | 'week' | 'month'

/** Response shape every /api/admin/financial/<tab> overview route returns.
 *  - `T` is the "totals" shape (what's compared current-vs-previous for KPI deltas).
 *  - `Row` is the row shape for the per-dimension tables.
 */
export interface FinanceOverviewContract<T, Row = Record<string, unknown>> {
  range: FinanceRange
  previous_range: FinanceRange
  bucket: FinanceBucket
  current: T
  previous: T
  series?: TrendPoint[]
  by_dim?: Row[]
  by_dim2?: Row[]
  top?: Row[]
}

/** Type guard: shallow structural check that `v` carries the common envelope fields.
 *  The per-tab `current`/`previous`/`by_dim*` payloads are narrowed by each tab's own types. */
export function isFinanceOverview<T, Row = Record<string, unknown>>(
  v: unknown
): v is FinanceOverviewContract<T, Row> {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const r = o.range as Record<string, unknown> | undefined
  const pr = o.previous_range as Record<string, unknown> | undefined
  return (
    !!r && typeof r.from === 'string' && typeof r.to === 'string' &&
    !!pr && typeof pr.from === 'string' && typeof pr.to === 'string' &&
    (o.bucket === 'day' || o.bucket === 'week' || o.bucket === 'month')
  )
}
