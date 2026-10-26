'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { listParamNames } from '@jeffi/list-filters/client'
import { QUOTATION_ALIASES, QUOTATION_FIELDS } from '@jeffi/list-filters/fields'
import { TabActionsHost, Tabs } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import { resolveOverviewTab, type OverviewTab } from '@/lib/overviews/sales-documents'
import QuotationsClient from './QuotationsClient'
import QuotationsOverview from './_components/QuotationsOverview'

// Params the list reads; a link carrying any of them (without ?tab) opens the list. from / to is
// also the Overview period, so it never flips the tab.
const LIST_KEYS = [
  'view',
  'edit',
  'product',
  'variant',
  ...listParamNames(QUOTATION_FIELDS, { aliases: QUOTATION_ALIASES }),
].filter(k => k !== 'from' && k !== 'to')

export default function QuotationsTabs({ canWrite }: { canWrite: boolean }) {
  const sp = useSearchParams()
  const router = useRouter()
  const tab = resolveOverviewTab(sp, LIST_KEYS)
  const editing = sp.get('view') === 'editor'

  const go = (t: OverviewTab) => {
    const p = new URLSearchParams(sp.toString())
    p.set('tab', t)
    router.replace(ap(`/admin/quotations?${p}`), { scroll: false })
  }

  return (
    <TabActionsHost>
      <div className="space-y-5">
        {!editing && (
          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'list', label: 'Quotations' },
            ]}
            value={tab}
            onChange={go}
          />
        )}
        {tab === 'overview' ? <QuotationsOverview /> : <QuotationsClient canWrite={canWrite} />}
      </div>
    </TabActionsHost>
  )
}
