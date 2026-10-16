'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { OverviewPanel, useTab } from '../../orders/_components/overview-shared'
import PackingSlipsClient from '../PackingSlipsClient'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'slips', label: 'Packing slips' },
] as const
type Tab = (typeof TABS)[number]['id']
const LIST_PARAMS = ['from', 'to', 'customer', 'status']

export default function PackingSlipsTabs({
  initialOrders,
}: {
  initialOrders: React.ComponentProps<typeof PackingSlipsClient>['initialOrders']
}) {
  // Old links carrying the slip filters open the slips tab.
  const [tab, setTab] = useTab<Tab>(['overview', 'slips'], 'overview', {
    legacy: sp => (LIST_PARAMS.some(k => sp.get(k)) ? 'slips' : null),
  })
  const bar = (
    <div className="mb-5">
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
    </div>
  )
  if (tab === 'slips') return <PackingSlipsClient initialOrders={initialOrders} tabs={bar} />
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Packing Slips</h1>
        <p className="text-sm text-foreground-muted mt-1">Download packing slips to attach to parcels</p>
      </div>
      {bar}
      {/* The slips list owns ?from&to, so the overview keeps its period locally. */}
      <OverviewPanel endpoint="/api/admin/packing-slips/overview" local fallback="7d" />
    </div>
  )
}
