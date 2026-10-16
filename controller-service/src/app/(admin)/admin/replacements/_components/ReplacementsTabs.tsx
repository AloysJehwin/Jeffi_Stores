'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { useTab } from '../../orders/_components/overview-shared'
import AdminReplacementsClient from '../AdminReplacementsClient'
import ReplacementsOverview from './ReplacementsOverview'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'list', label: 'Replacement requests' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function ReplacementsTabs() {
  const [tab, setTab] = useTab<Tab>(['overview', 'list'], 'overview')
  return (
    <div className="space-y-5">
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'overview' ? <ReplacementsOverview /> : <AdminReplacementsClient />}
    </div>
  )
}
