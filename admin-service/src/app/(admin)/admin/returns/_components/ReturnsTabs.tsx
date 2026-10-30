'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { isListUrl } from '@/lib/admin/filter-url'
import { RETURN_FIELDS } from '@/lib/filters/fields/returns'
import { useTab } from '../../orders/_components/overview-shared'
import AdminReturnsClient from '../AdminReturnsClient'
import ReturnsOverview from './ReturnsOverview'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'list', label: 'Return requests' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function ReturnsTabs() {
  // Links carrying list filters (or a bucket) and no tab open the list.
  const [tab, setTab] = useTab<Tab>(['overview', 'list'], 'overview', {
    legacy: sp => (sp.get('bucket') || isListUrl(Object.fromEntries(sp), RETURN_FIELDS) ? 'list' : null),
  })
  return (
    <div className="space-y-5">
      <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'overview' ? <ReturnsOverview /> : <AdminReturnsClient />}
    </div>
  )
}
