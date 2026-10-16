'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
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
    <div>
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
