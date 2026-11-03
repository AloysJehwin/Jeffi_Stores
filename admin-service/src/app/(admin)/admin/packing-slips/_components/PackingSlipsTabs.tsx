'use client'

import { Tabs } from '@/components/admin/channels/ui'
import { ListFilters, PageHeader, useFilterQuery } from '@/components/admin/kit'
import { isListUrl } from '@/lib/admin/filter-url'
import { PACKING_FIELDS, PACKING_SEARCH } from '@/lib/filters/fields/packing-slips'
import { OverviewPanel, useTab } from '../../orders/_components/overview-shared'
import PackingSlipsClient from '../PackingSlipsClient'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'slips', label: 'Packing slips' },
] as const
type Tab = (typeof TABS)[number]['id']

export default function PackingSlipsTabs() {
  // Links carrying slip filters and no tab open the slips tab.
  const [tab, setTab] = useTab<Tab>(['overview', 'slips'], 'overview', {
    legacy: sp => (isListUrl(Object.fromEntries(sp), PACKING_FIELDS) ? 'slips' : null),
  })
  const filters = useFilterQuery(PACKING_FIELDS, { omit: ['from', 'to'] })
  const header = (
    <>
      <div className="mb-5">
        <PageHeader title="Packing Slips" description="Packing slips, shipping labels and invoices for each order" />
      </div>
      <div className="mb-5">
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>
    </>
  )
  if (tab === 'slips') return <PackingSlipsClient header={header} />
  return (
    <div className="p-4 sm:p-6">
      {header}
      {/* The period is the slips list's order date; the strip follows the other filters too. */}
      <OverviewPanel
        endpoint="/api/admin/packing-slips/overview"
        fallback="7d"
        query={filters}
        filters={
          <ListFilters entity="packing_slips" fields={PACKING_FIELDS} search={PACKING_SEARCH} period noun="Orders" tab="overview" exportable />
        }
      />
    </div>
  )
}
