'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIsMobile } from '@/contexts/PortalDeviceContext'
import type { PortalSurfaceConfig } from '@/lib/portal-config'

// Shared sign-in for the portal surfaces: Google (popup OAuth, then the surface's Google route
// mints its cookie) and a one-time email code (start -> verify). Copy and endpoints come from the
// surface config; sizing follows the server-detected device.
export default function PortalSignIn({ config }: { config: PortalSurfaceConfig }) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const [step, setStep] = useState<'choose' | 'code'>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'google' | 'otp' | null>(null)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  const input = `w-full border border-border-secondary rounded-xl bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent ${isMobile ? 'px-4 py-3.5 text-base' : 'px-4 py-2.5 text-sm'}`
  const primary = `w-full rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50 ${isMobile ? 'py-3.5 text-base' : 'py-2.5 text-sm'}`
  const secondary = `w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border-default bg-surface-elevated hover:bg-surface-secondary font-medium text-foreground transition-colors disabled:opacity-50 ${isMobile ? 'py-3.5 text-base' : 'py-2.5 text-sm'}`

  function finish() {
    if (config.successHref) router.push(config.successHref)
    router.refresh()
  }

  async function google() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) { setError('Google sign-in is not configured in this environment.'); return }
    setBusy('google'); setError('')
    try {
      const { openGoogleOAuthPopup } = await import('@/lib/client/google-oauth-popup')
      const result = await openGoogleOAuthPopup({ clientId })
      if (!result.accessToken) {
        if (result.error && result.error !== 'popup_closed') setError(result.error)
        return
      }
      const res = await fetch(config.auth.google, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: result.accessToken }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Sign-in failed'); return }
      finish()
    } catch {
      setError('Network error')
    } finally {
      setBusy(null)
    }
  }

  function startCooldown(seconds: number) {
    setCooldown(seconds)
    const t = setInterval(() => setCooldown(c => { if (c <= 1) { clearInterval(t); return 0 } return c - 1 }), 1000)
  }

  async function sendCode() {
    setBusy('otp'); setError('')
    try {
      const res = await fetch(config.auth.otpStart, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send code'); if (data.retryAfter) startCooldown(data.retryAfter); return }
      setStep('code')
      startCooldown(data.nextCooldown || 30)
    } finally {
      setBusy(null)
    }
  }

  async function verify() {
    setBusy('otp'); setError('')
    try {
      const res = await fetch(config.auth.otpVerify, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), code: code.trim() }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Invalid code'); return }
      finish()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={isMobile ? '' : 'text-center'}>
      <h1 className={`font-bold text-foreground ${isMobile ? 'text-2xl' : 'text-2xl'}`}>{config.signIn.heading}</h1>
      <p className="mt-2 text-sm text-foreground-secondary">{config.signIn.description}</p>

      {step === 'choose' ? (
        <div className="mt-8 space-y-4">
          <button type="button" onClick={google} disabled={busy !== null} className={secondary}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>
            {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
          </button>
          <div className="flex items-center gap-3 text-xs text-foreground-muted"><span className="h-px flex-1 bg-border-default" />or<span className="h-px flex-1 bg-border-default" /></div>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); sendCode() }}>
            <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder={config.signIn.emailHint} className={input} />
            <button type="submit" disabled={busy !== null || !email.trim()} className={primary}>
              {busy === 'otp' ? 'Sending…' : 'Email me a code'}
            </button>
          </form>
        </div>
      ) : (
        <form className="mt-8 space-y-3" onSubmit={e => { e.preventDefault(); verify() }}>
          <p className="text-sm text-foreground-secondary">We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.</p>
          <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className={`${input} tracking-[0.4em] text-center font-mono text-xl`} autoFocus />
          <button type="submit" disabled={busy !== null || code.length !== 6} className={primary}>
            {busy === 'otp' ? 'Verifying…' : 'Sign in'}
          </button>
          <div className="flex items-center justify-between text-xs text-foreground-muted">
            <button type="button" onClick={() => { setStep('choose'); setCode(''); setError('') }} className="hover:underline">Back</button>
            <button type="button" disabled={cooldown > 0 || busy !== null} onClick={sendCode} className="hover:underline disabled:opacity-50">
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {config.signIn.footnote && <p className="mt-6 text-xs text-foreground-muted">{config.signIn.footnote}</p>}
    </div>
  )
}
