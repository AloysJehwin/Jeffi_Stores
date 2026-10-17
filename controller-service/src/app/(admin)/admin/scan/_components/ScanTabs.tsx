'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { OverviewPanel, useTab } from '../../orders/_components/overview-shared'
import ScanClient from '../ScanClient'

const TABS = [
  { id: 'scan', label: 'Scanner' },
  { id: 'overview', label: 'Overview' },
] as const
type Tab = (typeof TABS)[number]['id']

// A work screen: the scanner stays the default tab.
export default function ScanTabs() {
  const [tab, setTab] = useTab<Tab>(['scan', 'overview'], 'scan')
  return (
    <div className="flex flex-1 flex-col">
      <div className="px-4 pt-3 bg-surface">
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>
      {tab === 'scan' ? (
        <ScanClient />
      ) : (
        <div className="p-4 sm:p-6">
          <OverviewPanel endpoint="/api/admin/scan/overview" />
        </div>
      )}
    </div>
  )
}
