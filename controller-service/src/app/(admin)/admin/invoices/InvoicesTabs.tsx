'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import { resolveOverviewTab, type OverviewTab } from '@/lib/overviews/sales-documents'
import InvoicesClient from './InvoicesClient'
import InvoicesOverview from './_components/InvoicesOverview'

// Params the invoice list reads; a link carrying any of them (without ?tab) opens the list.
const LIST_KEYS = ['view', 'edit', 'product', 'variant', 'search', 'source', 'payment', 'page', 'sort'] as const

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
    <div className="space-y-5">
      {!editing && (
        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'list', label: 'Invoices' },
          ]}
          value={tab}
          onChange={go}
        />
      )}
      {tab === 'overview' ? <InvoicesOverview /> : <InvoicesClient canWrite={canWrite} />}
    </div>
  )
}
