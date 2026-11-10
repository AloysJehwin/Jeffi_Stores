'use client'

import { useState } from 'react'

const INPUT =
  'w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500'

/**
 * Email for a social sign-up whose provider shared none (or an unverified one): the address is
 * proven with the usual email code before the account is created.
 */
export default function OAuthEmailField({
  email,
  onEmail,
  verified,
  onVerified,
  userType,
}: {
  email: string
  onEmail: (v: string) => void
  verified: boolean
  onVerified: (v: boolean) => void
  userType?: 'business'
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Something went wrong')
  }

  async function send() {
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address')
      return
    }
    setBusy(true)
    try {
      await post('/api/auth/send-otp', { email: email.trim(), isSignup: true, channel: 'email', ...(userType ? { userType } : {}) })
      setSent(true)
      setCode('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send the code')
    } finally {
      setBusy(false)
    }
  }

  async function verify(value: string) {
    setError('')
    setBusy(true)
    try {
      await post('/api/auth/verify-otp', { email: email.trim(), otp: value })
      onVerified(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label htmlFor="oauth-email" className="block text-sm font-medium text-foreground-secondary mb-2">
        Email Address *
      </label>
      <div className="flex gap-2">
        <input
          id="oauth-email"
          type="email"
          required
          value={email}
          disabled={verified}
          onChange={e => {
            onEmail(e.target.value)
            setSent(false)
          }}
          className={`${INPUT} min-w-0 disabled:bg-surface-secondary disabled:text-foreground-muted`}
          placeholder="your@email.com"
        />
        {verified ? (
          <span className="inline-flex items-center px-3 text-sm font-medium text-green-600 dark:text-green-400 shrink-0">Verified</span>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={busy || !email.trim()}
            className="shrink-0 px-4 py-3 rounded-lg border border-border-secondary bg-surface hover:bg-surface-secondary text-sm font-medium text-foreground disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {sent ? 'Resend' : 'Send code'}
          </button>
        )}
      </div>
      {sent && !verified && (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          disabled={busy}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, '')
            setCode(v)
            if (v.length === 6) verify(v)
          }}
          aria-label="Email verification code"
          className={`${INPUT} mt-2 text-center tracking-widest`}
          placeholder="6-digit code from your email"
        />
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {!verified && !error && (
        <p className="mt-1 text-xs text-foreground-muted">We&apos;ll send a code to confirm this address is yours.</p>
      )}
    </div>
  )
}
