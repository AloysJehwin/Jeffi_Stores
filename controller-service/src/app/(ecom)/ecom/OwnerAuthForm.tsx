'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import type { GoogleOAuthResult } from '@/lib/client/google-oauth-popup'
import { trackOwnerAuth } from '@/lib/client/ecom-analytics'
import { AuthBusyOverlay } from '@/components/auth/AuthSplitShell'
import { useLeaveTo } from '@/components/auth/useLeaveTo'

// OTP + Google auth form for ecom owners. mode 'signup' collects a name; 'signin'
// doesn't. Both hit the same ecom auth endpoints (findOrCreateOwner upserts).
export default function OwnerAuthForm({ mode }: { mode: 'signup' | 'signin' }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const { leaving, go } = useLeaveTo()

  const field = 'w-full rounded-xl bg-surface-elevated px-4 py-3 text-foreground ecom-field border-transparent'
  const input = `${field} text-[16px] sm:text-sm`

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) showToast(data.error || 'Failed to send OTP', 'error')
      else setStep('otp')
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, name: mode === 'signup' ? name : undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Invalid OTP', 'error')
        return
      }
      trackOwnerAuth(mode, 'email')
      // New owner → onboarding wizard; returning → dashboard.
      go(mode === 'signup' ? '/onboard' : '/dashboard')
      router.refresh()
    } catch {
      showToast('Network error', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      {leaving && <AuthBusyOverlay text="Signing you in…" />}
      <div>
        <h1 className="font-display font-black text-3xl sm:text-4xl text-foreground text-center sm:text-left">
          {mode === 'signup' ? 'Create your store account' : 'Welcome back'}
        </h1>
        <p className="text-sm text-foreground-muted mt-2 text-center sm:text-left">
          {mode === 'signup' ? 'Start selling on your own Jeffi-powered store.' : 'Sign in to your store dashboard.'}
        </p>

        {step === 'email' ? (
          <form onSubmit={sendOtp} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <input
                className={input}
                placeholder="Your name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            )}
            <input
              className={input}
              type="email"
              placeholder="you@business.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <button
              disabled={busy}
              className="ecom-accent-bg w-full rounded-full disabled:opacity-50 text-white font-display font-bold py-3 transition-colors"
            >
              {busy ? 'Sending…' : 'Continue with email'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-4">
            <p className="text-sm text-foreground-secondary break-words">
              Enter the 6-digit code sent to <span className="font-medium">{email}</span>
            </p>
            <input
              className={`${field} tracking-[0.4em] text-center text-lg`}
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              required
            />
            <button
              disabled={busy}
              className="ecom-accent-bg w-full rounded-full disabled:opacity-50 text-white font-display font-bold py-3 transition-colors"
            >
              {busy ? 'Verifying…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="w-full min-h-11 sm:min-h-0 text-sm text-foreground-muted hover:text-foreground"
            >
              ← Use a different email
            </button>
          </form>
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-foreground-muted">
          <span className="flex-1 h-px bg-border-default" /> or <span className="flex-1 h-px bg-border-default" />
        </div>

        <GoogleButton mode={mode} onError={m => showToast(m, 'error')} />

        <p className="mt-6 text-center text-sm text-foreground-muted">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <a href="/signin" className="org-brown font-semibold hover:underline inline-block py-2 sm:inline sm:py-0">
                Sign in
              </a>
            </>
          ) : (
            <>
              New to Jeffi Commerce?{' '}
              <a href="/signup" className="org-brown font-semibold hover:underline inline-block py-2 sm:inline sm:py-0">
                Get started
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

// Google sign-in — uses the same popup OAuth flow as the storefront (returns an
// access token from Google), then posts it to the ecom owner auth route. This
// avoids Google Identity Services One Tap, which needs stricter origin config.
function GoogleButton({ mode, onError }: { mode: 'signup' | 'signin'; onError: (m: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const { leaving, go } = useLeaveTo()

  // Back from Google in this tab: finish sign-in with the returned token.
  useEffect(() => {
    if (/(^|[#&])access_token=/.test(window.location.hash)) setBusy(true)
    import('@/lib/client/google-oauth-popup').then(m => {
      const r = m.consumeGoogleRedirect()
      if (r) start(r)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function start(returned?: GoogleOAuthResult) {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) {
      onError('Google sign-in is not configured in this environment.')
      return
    }
    setBusy(true)
    try {
      const { openGoogleOAuthPopup } = await import('@/lib/client/google-oauth-popup')
      const result = returned ?? (await openGoogleOAuthPopup({ clientId }))
      if (!result.accessToken) {
        if (result.error && result.error !== 'popup_closed') onError(result.error)
        return
      }
      const res = await fetch('/api/ecom/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: result.accessToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        onError(data.error || 'Google sign-in failed')
        return
      }
      trackOwnerAuth(mode, 'google')
      go(mode === 'signup' ? '/onboard' : '/dashboard')
      router.refresh()
    } catch {
      onError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {(busy || leaving) && <AuthBusyOverlay text="Signing you in with Google…" />}
      <button
        onClick={() => start()}
        disabled={busy || leaving}
        className="org-sand org-sand-hover w-full inline-flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-foreground transition-colors disabled:opacity-50"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
          />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
          />
        </svg>
        {busy || leaving ? 'Signing in…' : 'Continue with Google'}
      </button>
    </>
  )
}
