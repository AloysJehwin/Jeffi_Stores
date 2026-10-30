'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import { ap } from '@/lib/shared/admin-path'
import type { OverviewTab } from '@/lib/overviews/sales-documents'

export default function SubscriptionsTabBar({ value }: { value: OverviewTab }) {
  const sp = useSearchParams()
  const router = useRouter()
  const go = (t: OverviewTab) => {
    const p = new URLSearchParams(sp.toString())
    p.set('tab', t)
    router.replace(ap(`/admin/subscriptions?${p}`), { scroll: false })
  }
  return (
    <div className="mb-5">
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'list', label: 'Subscriptions' },
        ]}
        value={value}
        onChange={go}
      />
    </div>
  )
}
