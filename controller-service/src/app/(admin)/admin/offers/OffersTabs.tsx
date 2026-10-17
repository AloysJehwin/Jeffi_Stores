'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Tabs } from '@/components/admin/channels/ui'
import OffersClient from './OffersClient'
import OffersListClient from './OffersListClient'
import OffersOverview from './OffersOverview'

type Tab = 'overview' | 'bank' | 'offers'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'bank', label: 'Bank Offers' },
  { id: 'offers', label: 'Offers' },
]

export default function OffersTabs({ canWrite }: { canWrite: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const raw = searchParams.get('tab')
  const tab: Tab = raw === 'offers' || raw === 'bank' ? raw : 'overview'

  function selectTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'overview') params.delete('tab')
    else params.set('tab', next)
    if (next !== 'overview') {
      params.delete('from')
      params.delete('to')
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} value={tab} onChange={selectTab} />

      {tab === 'overview' ? (
        <OffersOverview />
      ) : tab === 'bank' ? (
        <OffersClient canWrite={canWrite} />
      ) : (
        <OffersListClient canWrite={canWrite} />
      )}
    </div>
  )
}
