'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { TabActionsHost, Tabs } from '@/components/admin/channels/ui'
import { PageHeader } from '@/components/admin/kit'
import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'
import { ap } from '@/lib/shared/admin-path'
import type { OverviewTab } from '@/lib/overviews/sales-documents'
import CashSaleClient, { type View } from './CashSaleClient'
import CashSaleOverview from './_components/CashSaleOverview'
import HeldBills from './_components/HeldBills'

// The POS opens on the sale screen; Overview is the second tab.

export default function CashSaleTabs() {
  const sp = useSearchParams()
  const router = useRouter()
  const t = sp.get('tab')
  const tab: OverviewTab = t === 'overview' || t === 'drafts' ? t : 'list'
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
                { id: 'drafts', label: <DraftsTabLabel type="cash_sale" label="Held bills" /> },
                { id: 'overview', label: 'Overview' },
              ]}
              value={tab}
              onChange={go}
            />
          </>
        )}
        {tab === 'overview' ? (
          <CashSaleOverview />
        ) : tab === 'drafts' ? (
          <PageDrafts type="cash_sale">
            <HeldBills />
          </PageDrafts>
        ) : (
          <CashSaleClient onViewChange={setView} />
        )}
      </div>
    </TabActionsHost>
  )
}
