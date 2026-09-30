'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import OffersClient from './OffersClient'
import OffersListClient from './OffersListClient'

type Tab = 'bank' | 'offers'

export default function OffersTabs({ canWrite }: { canWrite: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const tab: Tab = searchParams.get('tab') === 'offers' ? 'offers' : 'bank'

  function selectTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'bank') params.delete('tab')
    else params.set('tab', 'offers')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-border mb-6" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bank'}
          onClick={() => selectTab('bank')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'bank'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-foreground-muted hover:text-foreground'
          }`}
        >
          Bank Offers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'offers'}
          onClick={() => selectTab('offers')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'offers'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-foreground-muted hover:text-foreground'
          }`}
        >
          Offers
        </button>
      </div>

      {tab === 'bank' ? <OffersClient canWrite={canWrite} /> : <OffersListClient canWrite={canWrite} />}
    </div>
  )
}
