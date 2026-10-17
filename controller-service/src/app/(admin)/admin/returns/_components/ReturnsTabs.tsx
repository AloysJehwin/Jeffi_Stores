'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { useTab } from '../../orders/_components/overview-shared'
import AdminReturnsClient from '../AdminReturnsClient'
import ReturnsOverview from './ReturnsOverview'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'list', label: 'Return requests' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function ReturnsTabs() {
  const [tab, setTab] = useTab<Tab>(['overview', 'list'], 'overview')
  return (
    <div className="space-y-5">
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'overview' ? <ReturnsOverview /> : <AdminReturnsClient />}
    </div>
  )
}
