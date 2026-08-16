'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// OTP + Google auth form for ecom owners. mode 'signup' collects a name; 'signin'
// doesn't. Both hit the same ecom auth endpoints (findOrCreateOwner upserts).
export default function OwnerAuthForm({ mode }: { mode: 'signup' | 'signin' }) {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const input = 'w-full rounded-lg border border-border-default bg-surface-elevated px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/ecom/auth/send-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) setErr(data.error || 'Failed to send OTP')
      else setStep('otp')
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/ecom/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, name: mode === 'signup' ? name : undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Invalid OTP'); return }
      // New owner → onboarding wizard; returning → dashboard.
      router.push(mode === 'signup' ? '/onboard' : '/dashboard')
      router.refresh()
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-2xl border border-border-default bg-surface-elevated p-6 sm:p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-foreground">{mode === 'signup' ? 'Create your store account' : 'Sign in'}</h1>
        <p className="text-sm text-foreground-muted mt-1">
          {mode === 'signup' ? 'Start selling on your own Jeffi-powered store.' : 'Welcome back to your store dashboard.'}
        </p>

        {step === 'email' ? (
          <form onSubmit={sendOtp} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <input className={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
            )}
            <input className={input} type="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button disabled={busy} className="w-full rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white font-medium py-2.5 transition-colors">
              {busy ? 'Sending…' : 'Continue with email'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-4">
            <p className="text-sm text-foreground-secondary">Enter the 6-digit code sent to <span className="font-medium">{email}</span></p>
            <input className={`${input} tracking-[0.4em] text-center text-lg`} inputMode="numeric" maxLength={6} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} required />
            <button disabled={busy} className="w-full rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white font-medium py-2.5 transition-colors">
              {busy ? 'Verifying…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            <button type="button" onClick={() => setStep('email')} className="w-full text-sm text-foreground-muted hover:text-foreground">← Use a different email</button>
          </form>
        )}

        {err && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{err}</p>}

        <div className="my-6 flex items-center gap-3 text-xs text-foreground-muted">
          <span className="flex-1 h-px bg-border-default" /> or <span className="flex-1 h-px bg-border-default" />
        </div>

        <GoogleButton mode={mode} onError={setErr} />

        <p className="mt-6 text-center text-sm text-foreground-muted">
          {mode === 'signup' ? (
            <>Already have an account? <a href="/signin" className="text-accent-600 dark:text-accent-400 hover:underline">Sign in</a></>
          ) : (
            <>New to Jeffi Commerce? <a href="/signup" className="text-accent-600 dark:text-accent-400 hover:underline">Get started</a></>
          )}
        </p>
      </div>
    </div>
  )
}

// Google sign-in — uses Google Identity Services if the client id is configured.
// Falls back to a disabled note otherwise (dev without GOOGLE_CLIENT_ID).
function GoogleButton({ mode, onError }: { mode: 'signup' | 'signin'; onError: (m: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleCredential(idToken: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/ecom/auth/google', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      if (!res.ok) { onError(data.error || 'Google sign-in failed'); return }
      router.push(mode === 'signup' ? '/onboard' : '/dashboard'); router.refresh()
    } catch { onError('Network error') } finally { setBusy(false) }
  }

  function start() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    const g = (window as any).google
    if (!clientId || !g?.accounts?.id) { onError('Google sign-in is not configured in this environment.'); return }
    g.accounts.id.initialize({ client_id: clientId, callback: (r: any) => handleCredential(r.credential) })
    g.accounts.id.prompt()
  }

  return (
    <button onClick={start} disabled={busy}
      className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-surface-elevated hover:bg-surface-secondary py-2.5 text-sm font-medium text-foreground transition-colors disabled:opacity-50">
      <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>
      {busy ? 'Signing in…' : 'Continue with Google'}
    </button>
  )
}
