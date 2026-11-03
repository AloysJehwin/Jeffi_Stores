'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { useTab } from '../../orders/_components/overview-shared'
import DelhiveryOverview from './DelhiveryOverview'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pickups', label: 'Pickup requests' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function DelhiveryTabs({ pickups }: { pickups: React.ReactNode }) {
  const [tab, setTab] = useTab<Tab>(['overview', 'pickups'], 'overview')
  return (
    <div className="space-y-5">
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'overview' ? (
        <DelhiveryOverview />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-foreground-secondary">
            Orders with an AWB not yet included in a pickup request. Pickup slot: 14:00–18:00.
          </p>
          {pickups}
        </div>
      )}
    </div>
  )
}
