'use client'

// Aging buckets donut used by receivables and payables. Thin wrapper over MixDonutCard with the
// canonical 0-30 / 31-60 / 61-90 / 90+ palette so both tabs stay visually consistent.

import { MixDonutCard } from '@/components/admin/kit/charts'

export const AGING_COLORS = {
  current: 'rgb(16 185 129)',  // green (0-30)
  d31_60: 'rgb(245 158 11)',   // amber (31-60)
  d61_90: 'rgb(249 115 22)',   // orange (61-90)
  d90_plus: 'rgb(239 68 68)',  // red   (90+)
} as const

export const AGING_PALETTE = [
  AGING_COLORS.current,
  AGING_COLORS.d31_60,
  AGING_COLORS.d61_90,
  AGING_COLORS.d90_plus,
] as const

export type AgingDonutRow = { label: string; value: number; color?: string }

export function AgingDonutCard({
  title = 'Aging',
  rows,
  total,
  centerLabel,
  hint,
}: {
  title?: string
  rows: AgingDonutRow[]
  total: string
  centerLabel: string
  hint?: string
}) {
  const segments = rows.map((r, i) => ({
    label: r.label,
    value: r.value,
    color: r.color ?? AGING_PALETTE[Math.min(i, AGING_PALETTE.length - 1)],
  }))
  return <MixDonutCard title={title} hint={hint} segments={segments} total={total} totalLabel={centerLabel} />
}
