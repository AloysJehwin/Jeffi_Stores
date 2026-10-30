'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { adsAllowedOn } from '@/lib/analytics/adsense'

type AdsQueue = unknown[] & { pauseAdRequests?: number }

// adsbygoogle.js loads after hydration (app/layout.tsx; the init in <head> runs first). Auto ads
// survive client-side navigation, so this pauses requests and hides placed ads on cart, checkout, account
// and the like, and resumes them on the way back.
export default function AdSense() {
  const pathname = usePathname()
  useEffect(() => {
    const allowed = adsAllowedOn(pathname || '/')
    document.documentElement.toggleAttribute('data-no-ads', !allowed)
    const w = window as unknown as { adsbygoogle?: AdsQueue }
    w.adsbygoogle = w.adsbygoogle || []
    w.adsbygoogle.pauseAdRequests = allowed ? 0 : 1
  }, [pathname])
  return null
}
