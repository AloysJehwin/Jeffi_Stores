'use client'

// Finance-wide period bar: kit's PeriodBar wired to the shared ?from&to URL state.
// Every finance tab mounts this once; the refresh button is per-tab.

import { PeriodBar } from '@/components/admin/overview/kit'
import { useFinancePeriod, type FinancePreset } from './finance-period'

export function FinancePeriodBar({
  onRefresh,
  busy,
  defaultPreset = '30d',
}: {
  onRefresh?: () => void
  busy?: boolean
  defaultPreset?: FinancePreset
}) {
  const { range, setRange } = useFinancePeriod(defaultPreset)
  return <PeriodBar value={range} onChange={setRange} onRefresh={onRefresh} busy={busy} />
}
