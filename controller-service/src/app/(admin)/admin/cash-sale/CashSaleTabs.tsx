'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TabActionsHost, Tabs } from '@/components/admin/channels/ui'
import { PageHeader } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import type { OverviewTab } from '@/lib/overviews/sales-documents'
import CashSaleClient, { type View } from './CashSaleClient'
import CashSaleOverview from './_components/CashSaleOverview'

// The POS opens on the sale screen; Overview is the second tab.

export default function CashSaleTabs() {
  const sp = useSearchParams()
  const router = useRouter()
  const tab: OverviewTab = sp.get('tab') === 'overview' ? 'overview' : 'list'
  const [view, setView] = useState<View>('list')
  const editing = tab === 'list' && view !== 'list'

  const go = (t: OverviewTab) => {
    const p = new URLSearchParams(sp.toString())
    p.set('tab', t)
    router.replace(ap(`/admin/cash-sale?${p}`), { scroll: false })
  }

  return (
    <TabActionsHost>
      <div className="space-y-5">
        {!editing && (
          <>
            <PageHeader title="Cash Sales" description="Walk-in sales — no customer details" />
            <Tabs
              tabs={[
                { id: 'list', label: 'New sale' },
                { id: 'overview', label: 'Overview' },
              ]}
              value={tab}
              onChange={go}
            />
          </>
        )}
        {tab === 'overview' ? <CashSaleOverview /> : <CashSaleClient onViewChange={setView} />}
      </div>
    </TabActionsHost>
  )
}
