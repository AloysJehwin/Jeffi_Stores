'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Reuses the storefront/ecom Google popup OAuth flow (returns an access token), then posts it to
// the cert-portal auth route which mints the portal cookie. On success, go to the cert list.
export default function CertPortalSignIn() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) { setError('Google sign-in is not configured in this environment.'); return }
    setBusy(true)
    setError(null)
    try {
      const { openGoogleOAuthPopup } = await import('@/lib/google-oauth-popup')
      const result = await openGoogleOAuthPopup({ clientId })
      if (!result.accessToken) {
        if (result.error && result.error !== 'popup_closed') setError(result.error)
        return
      }
      const res = await fetch('/api/certportal/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: result.accessToken }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Sign-in failed'); return }
      router.push('/certs'); router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button onClick={start} disabled={busy}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-elevated hover:bg-surface-secondary py-2.5 text-sm font-medium text-foreground transition-colors disabled:opacity-50">
        <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
