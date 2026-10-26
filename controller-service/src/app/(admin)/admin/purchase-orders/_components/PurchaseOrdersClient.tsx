'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { listParamNames } from '@jeffi/list-filters/client'
import { PO_ALIASES, PO_FIELDS } from '@jeffi/list-filters/fields'
import { tabHref } from '@/lib/admin/filter-url'
import { TabAction, TabActionsHost, Tabs } from '@/components/admin/kit/core'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import PurchaseOrdersOverview from './PurchaseOrdersOverview'
import PurchaseOrdersTab from './PurchaseOrdersTab'

type Tab = 'overview' | 'orders'

// The list's own params (from / to is also the Overview period, so it never picks the tab).
const LIST_KEYS = listParamNames(PO_FIELDS, { aliases: PO_ALIASES }).filter(k => k !== 'from' && k !== 'to')

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Purchase orders' },
]

export default function PurchaseOrdersClient() {
  const sp = useSearchParams()
  const router = useRouter()
  const po = sp.get('po') || undefined
  // A ?po= deep link (or a filtered link) opens the list even without ?tab.
  const listy = !!po || LIST_KEYS.some(k => sp.get(k))
  const tab: Tab = sp.get('tab') === 'orders' || (listy && !sp.get('tab')) ? 'orders' : 'overview'

  // Switching tabs keeps the filters (and the period).
  const go = (t: Tab) =>
    router.push(ap(tabHref('/admin/purchase-orders', t, sp, PO_FIELDS, { aliases: PO_ALIASES })), { scroll: false })

  return (
    <TabActionsHost>
      <div className="space-y-5">
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={go}
          actions={
            <RequireWrite scope="inventory">
              <TabAction
                href={ap('/admin/purchase-orders/new')}
                icon={<Plus className="w-4 h-4" />}
                label="New purchase order"
              />
            </RequireWrite>
          }
        />
        {tab === 'overview' ? <PurchaseOrdersOverview /> : <PurchaseOrdersTab key={po} initialPO={po} />}
      </div>
    </TabActionsHost>
  )
}
