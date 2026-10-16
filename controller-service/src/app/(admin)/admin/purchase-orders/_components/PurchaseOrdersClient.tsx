'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { TabAction, TabActionsHost, Tabs } from '@/components/admin/channels/ui'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import PurchaseOrdersOverview from './PurchaseOrdersOverview'
import PurchaseOrdersTab from './PurchaseOrdersTab'

type Tab = 'overview' | 'orders'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Purchase orders' },
]

export default function PurchaseOrdersClient() {
  const sp = useSearchParams()
  const router = useRouter()
  const po = sp.get('po') || undefined
  // A ?po= deep link opens the list even without ?tab.
  const tab: Tab = sp.get('tab') === 'orders' || (po && !sp.get('tab')) ? 'orders' : 'overview'

  const go = (t: Tab) => router.push(ap(`/admin/purchase-orders?tab=${t}`), { scroll: false })

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
