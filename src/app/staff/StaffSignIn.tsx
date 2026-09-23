'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass = 'w-full px-4 py-3 border border-border-secondary rounded-xl bg-surface text-foreground text-base placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent'

export default function StaffSignIn({ storeName }: { storeName: string }) {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  async function start() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/staff/auth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send code'); if (data.retryAfter) setCooldown(data.retryAfter); return }
      setStep('code')
      setCooldown(data.nextCooldown || 30)
      const t = setInterval(() => setCooldown(c => { if (c <= 1) { clearInterval(t); return 0 } return c - 1 }), 1000)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/staff/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), code: code.trim() }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Invalid code'); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">{storeName}</p>
      <h1 className="text-2xl font-bold mt-1">Staff Notes</h1>
      <p className="text-sm text-foreground-secondary mt-2">
        Sign in with your admin email to add photos and notes to a customer. No certificate needed.
      </p>

      <form className="mt-8 space-y-4" onSubmit={e => { e.preventDefault(); step === 'email' ? start() : verify() }}>
        {step === 'email' ? (
          <>
            <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@store.com" className={inputClass} />
            <button type="submit" disabled={busy || !email.trim()} className="w-full py-3 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50">
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground-secondary">We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.</p>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className={`${inputClass} tracking-[0.4em] text-center font-mono text-xl`} />
            <button type="submit" disabled={busy || code.length !== 6} className="w-full py-3 rounded-xl bg-accent-500 hover:bg-accent-600 text-white font-semibold disabled:opacity-50">
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <div className="flex items-center justify-between text-xs text-foreground-muted">
              <button type="button" onClick={() => { setStep('email'); setCode(''); setError('') }} className="hover:underline">Use a different email</button>
              <button type="button" disabled={cooldown > 0 || busy} onClick={start} className="hover:underline disabled:opacity-50">
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </main>
  )
}
