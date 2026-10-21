'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { adsAllowedOn } from '@/lib/analytics/adsense'
import { readConsent } from '@/lib/client/consent'

// Loads the AdSense script (Auto ads) once a visitor reaches a page that may carry ads. Until the
// visitor accepts marketing cookies only non-personalised ads are requested; a store may load no Google
// tag of its own, so this doesn't rely on Consent Mode alone.
export default function AdSense({ client }: { client: string }) {
  const pathname = usePathname()
  const [load, setLoad] = useState(false)

  // Auto ads survive client-side navigation, so hide them again on cart, checkout, account and the like.
  useEffect(() => {
    const allowed = adsAllowedOn(pathname || '/')
    document.documentElement.toggleAttribute('data-no-ads', !allowed)
    if (load || !allowed) return
    const w = window as unknown as { adsbygoogle?: unknown[] & { requestNonPersonalizedAds?: number } }
    w.adsbygoogle = w.adsbygoogle || []
    w.adsbygoogle.requestNonPersonalizedAds = readConsent()?.ads ? 0 : 1
    setLoad(true)
  }, [pathname, load])

  if (!load) return null
  return (
    <Script
      id="adsense"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`}
      strategy="afterInteractive"
      crossOrigin="anonymous"
    />
  )
}
