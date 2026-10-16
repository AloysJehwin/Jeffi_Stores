'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { TabActionsHost, Tabs } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import type { OverviewTab } from '@/lib/overviews/sales-documents'
import CashSaleClient from './CashSaleClient'
import CashSaleOverview from './_components/CashSaleOverview'

// The POS opens on the sale screen; Overview is the second tab.

export default function CashSaleTabs() {
  const sp = useSearchParams()
  const router = useRouter()
  const tab: OverviewTab = sp.get('tab') === 'overview' ? 'overview' : 'list'

  const go = (t: OverviewTab) => {
    const p = new URLSearchParams(sp.toString())
    p.set('tab', t)
    router.replace(ap(`/admin/cash-sale?${p}`), { scroll: false })
  }

  return (
    <TabActionsHost>
      <div className="space-y-5">
        <Tabs
          tabs={[
            { id: 'list', label: 'New sale' },
            { id: 'overview', label: 'Overview' },
          ]}
          value={tab}
          onChange={go}
        />
        {tab === 'overview' ? <CashSaleOverview /> : <CashSaleClient />}
      </div>
    </TabActionsHost>
  )
}
