'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface PhoneVerifyModalProps {
  requiresPolicy?: boolean
  title?: string
  initialPhone?: string
  onVerified: () => void
  onCancel: () => void
}

export default function PhoneVerifyModal({
  requiresPolicy = false,
  title,
  initialPhone = '',
  onVerified,
  onCancel,
}: PhoneVerifyModalProps) {
  const { refreshUser } = useAuth()
  const [stage, setStage] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState(initialPhone.replace(/\D/g, '').slice(-10))
  const [otp, setOtp] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendOtp(e?: React.FormEvent) {
    e?.preventDefault()
    setError('')
    if (phone.length !== 10) {
      setError('Enter a valid 10-digit mobile number')
      return
    }
    if (requiresPolicy && !policyAccepted) {
      setError('Please accept the Privacy Policy and Terms & Conditions')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/phone/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number') setCooldown(data.retryAfter)
        throw new Error(data.error || 'Failed to send OTP')
      }
      setStage('otp')
      setCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 30)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp(e?: React.FormEvent) {
    e?.preventDefault()
    setError('')
    if (otp.length !== 6) {
      setError('Enter the 6-digit OTP')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/phone/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone, otp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to verify OTP')

      if (requiresPolicy && policyAccepted) {
        await fetch('/api/user/accept-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        }).catch(() => {})
      }

      await refreshUser()
      onVerified()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-surface-elevated rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {title || (stage === 'otp' ? 'Verify Mobile Number' : 'Add Mobile Number')}
        </h3>
        <p className="text-sm text-foreground-secondary mb-6">
          {stage === 'otp'
            ? `Enter the 6-digit code sent to +91 ${phone}.`
            : `Add your mobile number${requiresPolicy ? ' and accept our policies' : ''} so we can keep you updated on your orders.`}
        </p>

        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        {stage === 'phone' ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div>
              <label htmlFor="pv-phone" className="block text-sm font-medium text-foreground-secondary mb-2">
                Mobile Number *
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-4 py-3 border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary text-foreground-secondary text-sm font-medium">
                  +91
                </span>
                <input
                  id="pv-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  required
                  autoFocus
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 border border-border-secondary rounded-r-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                  placeholder="00000 00000"
                />
              </div>
              {phone.length > 0 && phone.length !== 10 && (
                <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
              )}
            </div>

            {requiresPolicy && (
              <label className="flex items-start gap-2 text-sm text-foreground-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={policyAccepted}
                  onChange={e => setPolicyAccepted(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-accent-500 cursor-pointer"
                />
                <span>
                  I agree to the{' '}
                  <a
                    href="/legal/privacy-policy"
                    target="_blank"
                    rel="noopener"
                    className="text-accent-500 hover:underline font-medium"
                  >
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a
                    href="/legal/terms-and-conditions"
                    target="_blank"
                    rel="noopener"
                    className="text-accent-500 hover:underline font-medium"
                  >
                    Terms &amp; Conditions
                  </a>
                  .
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading || phone.length !== 10 || (requiresPolicy && !policyAccepted)}
              className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <>
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Sending...
                </>
              ) : (
                'Send OTP'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div>
              <label htmlFor="pv-otp" className="block text-sm font-medium text-foreground-secondary mb-2">
                Enter OTP *
              </label>
              <input
                id="pv-otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                required
                autoFocus
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 tracking-[0.5em] text-center border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <>
                  <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                  Verifying...
                </>
              ) : (
                'Verify & Continue'
              )}
            </button>

            <button
              type="button"
              onClick={() => cooldown === 0 && sendOtp()}
              disabled={cooldown > 0 || loading}
              className="w-full text-sm text-accent-600 hover:underline disabled:text-foreground-muted disabled:no-underline disabled:cursor-not-allowed"
            >
              {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStage('phone')
                setOtp('')
                setError('')
              }}
              className="w-full text-sm text-foreground-muted hover:text-foreground"
            >
              Change number
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="w-full mt-4 text-sm text-foreground-muted hover:text-foreground"
        >
          Cancel and sign out
        </button>
      </div>
    </div>
  )
}
