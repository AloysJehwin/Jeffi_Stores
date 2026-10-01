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
      // Normal popup flow — post the token back to the opener and close.
      // Use '*' as targetOrigin so it works across subdomains.
      window.opener.postMessage(
        {
          source: 'jeffi-google-oauth',
          accessToken,
          error,
        },
        '*'
      )
      setTimeout(() => window.close(), 100)
      return
    }

    // Popup was blocked and Google opened this as a new tab / redirected the
    // top-level window. Read the return_to path from the state param (encoded
    // by openGoogleOAuthPopup) — fall back to /admin/login if absent or invalid.
    const state = params.get('state') || ''
    let returnTo = '/admin/login'
    try {
      // state may be "randomPart|/return/path" — parse the second segment if present
      const pipe = state.indexOf('|')
      if (pipe !== -1) {
        const candidate = decodeURIComponent(state.slice(pipe + 1))
        // only allow same-origin paths
        if (candidate.startsWith('/')) returnTo = candidate
      }
    } catch {
      /* ignore */
    }

    // Redirect back to the originating page with the hash so its own
    // hash-fallback handler can pick up the token and complete sign-in.
    window.location.replace(`${returnTo}#${hash}`)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-foreground">
      <div className="text-center">
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2.5 h-2.5 bg-accent-500 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="text-foreground-secondary text-sm">Completing sign-in…</p>
      </div>
    </div>
  )
}
