'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { adsAllowedOn } from '@/lib/analytics/adsense'

type AdsQueue = unknown[] & { pauseAdRequests?: number }

// adsbygoogle.js is server-rendered in <head> (crawlers and AdSense site verification read it there). Auto ads
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
