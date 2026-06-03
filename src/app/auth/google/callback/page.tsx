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
      window.opener.postMessage(
        {
          source: 'jeffi-google-oauth',
          accessToken,
          error,
        },
        window.location.origin
      )
      setTimeout(() => window.close(), 100)
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface text-foreground">
      <div className="text-center">
        <div className="animate-spin w-10 h-10 border-4 border-accent-500 border-t-transparent rounded-full mx-auto" />
        <p className="mt-4 text-foreground-secondary text-sm">Completing sign-in…</p>
      </div>
    </div>
  )
}
