'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { openGoogleOAuthPopup } from '@/lib/google-oauth-popup'

// On business.jeffistores.in pages live at /signin, /signup, /pending — no /business prefix needed
function bp(path: string) {
  if (typeof window !== 'undefined' && window.location.hostname.startsWith('business.')) {
    return path.replace(/^\/business/, '') || '/'
  }
  return path
}

export default function BusinessSignInWrapper() {
  return (
    <Suspense>
      <BusinessSignInPage />
    </Suspense>
  )
}

function BusinessSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && user?.isBusiness && user.approvalStatus === 'approved') {
      router.replace(bp('/business'))
    }
    if (!authLoading && user?.isBusiness && user.approvalStatus === 'pending') {
      router.replace(bp('/business/pending'))
    }
  }, [user, authLoading])

  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const otpInputRef = useRef<HTMLInputElement>(null)
  const submittedOtpRef = useRef<string>('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneError, setPhoneError] = useState('')

  const rejectedParam = searchParams.get('rejected')

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, isSignup: false, userType: 'business' }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number') {
          setResendCooldown(data.retryAfter)
          setStep('otp')
          throw new Error(data.error || 'Please wait before requesting another OTP')
        }
        if (data.userNotFound) {
          router.push(`${bp('/business/signup')}?email=${encodeURIComponent(email)}`)
          return
        }
        throw new Error(data.error || 'Failed to send OTP')
      }
      setStep('otp')
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 30)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const submitLogin = async (otpValue: string) => {
    if (submittedOtpRef.current === otpValue) return
    submittedOtpRef.current = otpValue
    setError('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/business/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, otp: otpValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.notBusinessAccount) {
          router.push(`${bp('/business/signup')}?email=${encodeURIComponent(email)}`)
          return
        }
        throw new Error(data.error || 'Login failed')
      }

      if (data.approvalStatus === 'pending') {
        router.push(bp('/business/pending'))
        return
      }
      if (data.approvalStatus === 'rejected') {
        setError('Your business account application was not approved. Please contact support.')
        setOtp('')
        submittedOtpRef.current = ''
        return
      }
      // Redirect to business portal
      window.location.href = bp('/business')
    } catch (err: any) {
      setError(err.message)
      setOtp('')
      submittedOtpRef.current = ''
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length === 6) await submitLogin(otp)
  }

  useEffect(() => {
    if (step !== 'otp' || otp.length !== 6 || isLoading) return
    submitLogin(otp)
  }, [otp, step, isLoading])

  const handleResendOTP = async () => {
    setError('')
    setOtp('')
    submittedOtpRef.current = ''
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, isSignup: false, userType: 'business' }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number') setResendCooldown(data.retryAfter)
        throw new Error(data.error || 'Failed to resend OTP')
      }
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 60)
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    setError('')
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) { setError('Google sign-in is not configured'); return }
    setGoogleLoading(true)
    const result = await openGoogleOAuthPopup({ clientId })
    if (!result.accessToken) {
      if (result.error && result.error !== 'popup_closed') setError(result.error)
      setGoogleLoading(false)
      return
    }
    try {
      const res = await fetch('/api/business/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accessToken: result.accessToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Google sign-in failed')

      if (data.needsBusinessProfile) {
        router.push(`${bp('/business/signup')}?google=1&token=${result.accessToken}`)
        return
      }
      if (data.approvalStatus === 'pending') {
        router.push(bp('/business/pending'))
        return
      }
      if (!data.phone) {
        setShowPhoneModal(true)
        return
      }
      window.location.href = bp('/business')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleSavePhone = async (e: React.FormEvent) => {
    e.preventDefault()
    setPhoneError('')
    if (!phone || phone.length !== 10) {
      setPhoneError('Enter a valid 10-digit mobile number')
      return
    }
    setPhoneSaving(true)
    try {
      const res = await fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Portal': 'business' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save phone number')
      }
      window.location.href = bp('/business')
    } catch (err: any) {
      setPhoneError(err.message)
    } finally {
      setPhoneSaving(false)
    }
  }

  return (
    <>
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — form */}
      <div className="flex items-center justify-center px-6 py-12 bg-surface">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <Link href="/" className="text-sm text-foreground-muted hover:text-foreground mb-6 flex items-center gap-1">
              ← Back to store
            </Link>
            <h1 className="text-3xl font-bold text-foreground">Business Sign In</h1>
            <p className="text-sm text-foreground-secondary mt-2">
              Access your Jeffi Stores business partner account
            </p>
          </div>

          {rejectedParam && (
            <div className="mb-5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
              Your business account application was not approved. Please contact support.
            </div>
          )}

          {error && (
            <div className="mb-5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Google */}
          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border-secondary bg-surface hover:bg-surface-secondary transition-colors text-sm font-medium text-foreground disabled:opacity-60 mb-5"
              >
                {googleLoading ? (
                  <div className="w-5 h-5 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                )}
                {googleLoading ? 'Signing in…' : 'Continue with Google'}
              </button>
              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border-default" /></div>
                <div className="relative flex justify-center text-xs"><span className="px-3 bg-surface text-foreground-muted">or continue with email</span></div>
              </div>
            </>
          )}

          {step === 'email' && (
            <form onSubmit={handleSendOTP} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Business Email</label>
                <input
                  type="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                  placeholder="you@company.com"
                />
              </div>
              <button type="submit" disabled={isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center">
                {isLoading ? <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Sending…</> : 'Send Verification Code'}
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  We&apos;ve sent a 6-digit code to <strong>{email}</strong>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Verification Code</label>
                <input
                  type="text" required maxLength={6} value={otp}
                  ref={otpInputRef}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  className={`w-full px-4 py-3 border rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-accent-500 text-center text-2xl tracking-widest ${
                    otp.length === 6 ? 'border-green-500 ring-2 ring-green-200 dark:ring-green-900/40' : 'border-border-secondary'
                  }`}
                  placeholder="000000"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={handleResendOTP} disabled={isLoading || resendCooldown > 0}
                  className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium disabled:opacity-50">
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                </button>
                <button type="button" onClick={() => { setStep('email'); setOtp(''); submittedOtpRef.current = '' }}
                  className="text-foreground-secondary hover:text-foreground">
                  Change Email
                </button>
              </div>
              <button type="submit" disabled={otp.length !== 6 || isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center">
                {isLoading ? <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Signing in…</> : 'Sign In'}
              </button>
            </form>
          )}

          <p className="mt-6 text-sm text-center text-foreground-secondary">
            New business partner?{' '}
            <Link href={bp('/business/signup')} className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">
              Apply for access
            </Link>
          </p>
        </div>
      </div>

      {/* Right — hero */}
      <div className="hidden lg:flex flex-col justify-center px-12 bg-gradient-to-br from-secondary-600 to-secondary-800 text-white">
        <div className="max-w-md">
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-8">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold mb-4 leading-tight">
            Your exclusive B2B partner portal
          </h2>
          <p className="text-white/70 text-base leading-relaxed mb-8">
            Access custom pricing, request quotes on bulk orders, and manage your business purchases — all in one place.
          </p>
          <ul className="space-y-3">
            {[
              'Custom discount rates on your categories',
              'Request for Quote (RFQ) on any product',
              'Dedicated support for bulk orders',
              'Full order history and invoices',
            ].map(item => (
              <li key={item} className="flex items-center gap-3 text-sm text-white/80">
                <svg className="w-5 h-5 text-accent-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>

    {showPhoneModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">One last step</h2>
          <p className="text-sm text-foreground-secondary mb-5">Please enter your mobile number to complete sign-in.</p>
          {phoneError && (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400">{phoneError}</p>
          )}
          <form onSubmit={handleSavePhone} className="space-y-4">
            <div>
              <label htmlFor="phone-modal-b" className="block text-sm font-medium text-foreground-secondary mb-2">
                Mobile Number
              </label>
              <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-accent-500 focus-within:border-accent-500">
                <span className="px-3 py-3 bg-surface-secondary text-foreground-secondary text-sm border-r border-border-secondary">+91</span>
                <input
                  id="phone-modal-b"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="10-digit mobile number"
                  autoFocus
                  className="flex-1 px-3 py-3 bg-transparent text-foreground placeholder:text-foreground-muted focus:outline-none text-sm"
                />
              </div>
              {phone.length > 0 && phone.length !== 10 && (
                <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
              )}
            </div>
            <button
              type="submit"
              disabled={phoneSaving || phone.length !== 10}
              className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center text-sm"
            >
              {phoneSaving ? (
                <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />Saving…</>
              ) : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    )}
    </>
  )
}
