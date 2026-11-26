'use client'

// Finance-wide period bar: kit's PeriodBar wired to the shared ?from&to URL state.
// Every finance tab mounts this once; the refresh button is per-tab.

import type { ReactNode } from 'react'
import { PeriodBar } from '@/components/admin/overview/kit'
import { useFinancePeriod, type FinancePreset } from './finance-period'

export function FinancePeriodBar({
  onRefresh,
  busy,
  defaultPreset = '30d',
  actions,
}: {
  onRefresh?: () => void
  busy?: boolean
  defaultPreset?: FinancePreset
  actions?: ReactNode
}) {
  const { range, setRange } = useFinancePeriod(defaultPreset)
  return <PeriodBar value={range} onChange={setRange} onRefresh={onRefresh} busy={busy} actions={actions} />
}
