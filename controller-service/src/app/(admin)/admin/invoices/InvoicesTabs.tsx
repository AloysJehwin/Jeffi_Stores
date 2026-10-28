'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { listParamNames } from '@jeffi/list-filters/client'
import { INVOICE_ALIASES, INVOICE_FIELDS } from '@jeffi/list-filters/fields'
import { TabActionsHost, Tabs } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'
import { resolveOverviewTab, type OverviewTab } from '@/lib/overviews/sales-documents'
import InvoicesClient from './InvoicesClient'
import InvoicesOverview from './_components/InvoicesOverview'

// Params the list reads; a link carrying any of them (without ?tab) opens the list. from / to is
// also the Overview period, so it never flips the tab.
const LIST_KEYS = [
  'view',
  'edit',
  'product',
  'variant',
  'page',
  'sort',
  ...listParamNames(INVOICE_FIELDS, { aliases: INVOICE_ALIASES }),
].filter(k => k !== 'from' && k !== 'to')

export default function InvoicesTabs({ canWrite }: { canWrite: boolean }) {
  const sp = useSearchParams()
  const router = useRouter()
  const tab = resolveOverviewTab(sp, LIST_KEYS)
  const editing = sp.get('view') === 'create' || sp.get('view') === 'edit'

  const go = (t: OverviewTab) => {
    const p = new URLSearchParams(sp.toString())
    p.set('tab', t)
    router.replace(ap(`/admin/invoices?${p}`), { scroll: false })
  }

  return (
    <TabActionsHost>
      <div className="space-y-5">
        {!editing && (
          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'list', label: 'Invoices' },
              { id: 'drafts', label: <DraftsTabLabel type="invoice" /> },
            ]}
            value={tab}
            onChange={go}
          />
        )}
        {tab === 'overview' ? <InvoicesOverview /> : tab === 'drafts' ? <PageDrafts type="invoice" /> : <InvoicesClient canWrite={canWrite} />}
      </div>
    </TabActionsHost>
  )
}
