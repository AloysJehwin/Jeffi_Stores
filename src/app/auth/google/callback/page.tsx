'use client'

import { useEffect } from 'react'

export default function GoogleCallbackPage() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const error = params.get('error')

    if (window.opener) {
      // Use '*' as targetOrigin so it works across subdomains (jeffistores.in ↔ business.jeffistores.in).
      // The message payload contains no secrets — the access_token is already in the hash fragment
      // which is also visible to the opener's domain via the popup URL.
      window.opener.postMessage(
        {
          source: 'jeffi-google-oauth',
          accessToken,
          error,
        },
        '*'
      )
      setTimeout(() => window.close(), 100)
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-foreground">
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
        <p className="text-foreground-secondary text-sm">Completing sign-in…</p>
      </div>
    </div>
  )
}
