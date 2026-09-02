'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { openGoogleOAuthPopup } from '@/lib/google-oauth-popup'

export default function LoginPageWrapper() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  )
}

function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawRedirect = searchParams.get('redirect') || '/'
  const redirect = ['/login', '/signup'].some(p => rawRedirect.startsWith(p)) ? '/' : rawRedirect
  const { user, isLoading: authLoading, login, googleLoginWithAccessToken, refreshUser } = useAuth()
  const { refreshCart } = useCart()
  const { showToast } = useToast()
  const config = useStoreConfig()

  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [loginPhone, setLoginPhone] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<'email' | 'sms' | 'whatsapp'>('email')
  const [channel, setChannel] = useState<'email' | 'sms' | 'whatsapp'>('email')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [requiresPolicy, setRequiresPolicy] = useState(false)
  const otpInputRef = useRef<HTMLInputElement>(null)
  const submittedOtpRef = useRef<string>('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [phonePolicyAccepted, setPhonePolicyAccepted] = useState(false)
  const [phoneRequiresPolicy, setPhoneRequiresPolicy] = useState(false)

  useEffect(() => {
    if (!authLoading && user && !showPhoneModal) {
      router.replace(redirect)
    }
  }, [user, authLoading, showPhoneModal])

  // Hash fallback: when the popup was blocked, the callback page redirects back
  // here with the access_token in the URL hash. Pick it up and complete sign-in.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const hashError = params.get('error')
    if (!accessToken && !hashError) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (hashError || !accessToken) { setError('Google sign-in failed. Please try again.'); return }
    setError(''); setGoogleLoading(true)
    googleLoginWithAccessToken(accessToken)
      .then(async (loggedInUser) => {
        await refreshCart()
        const needsPhone = !loggedInUser?.phone
        const needsPolicy = !!loggedInUser?.requiresPolicyAcceptance
        if (needsPhone || needsPolicy) { setPhoneRequiresPolicy(needsPolicy); setShowPhoneModal(true) }
        else router.push(redirect)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Google sign-in failed'))
      .finally(() => setGoogleLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  async function handleGoogleButtonClick() {
    setError('')
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) {
      setError('Google sign-in is not configured')
      return
    }
    setGoogleLoading(true)
    const result = await openGoogleOAuthPopup({ clientId, returnTo: '/login' })
    if (!result.accessToken) {
      if (result.error && result.error !== 'popup_closed') {
        setError(result.error)
      }
      setGoogleLoading(false)
      return
    }
    try {
      const loggedInUser = await googleLoginWithAccessToken(result.accessToken)
      await refreshCart()
      const needsPhone = !loggedInUser?.phone
      const needsPolicy = !!loggedInUser?.requiresPolicyAcceptance
      if (needsPhone || needsPolicy) {
        setPhoneRequiresPolicy(needsPolicy)
        setShowPhoneModal(true)
      } else {
        router.push(redirect)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (selectedChannel !== 'email' && loginPhone.length !== 10) {
      setError('Enter a valid 10-digit mobile number')
      return
    }
    setIsLoading(true)
    setChannel(selectedChannel)
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, phone: `+91${loginPhone}`, channel: selectedChannel, isSignup: false }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 429 && typeof data.retryAfter === 'number') {
          setResendCooldown(data.retryAfter)
          setStep('otp')
          throw new Error(data.error || 'Please wait before requesting another OTP')
        }
        if (data.userNotFound) {
          router.push(`/signup?email=${encodeURIComponent(email)}&from=login${redirect !== '/' ? `&redirect=${encodeURIComponent(redirect)}` : ''}`)
          return
        }
        throw new Error(data.error || 'Failed to send OTP')
      }
      setStep('otp')
      setRequiresPolicy(!!data.requiresPolicyAcceptance)
      setPolicyAccepted(false)
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 30)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const submitLogin = async (otpValue: string) => {
    if (submittedOtpRef.current === otpValue) return
    if (requiresPolicy && !policyAccepted) return
    submittedOtpRef.current = otpValue
    setError('')
    setIsLoading(true)
    try {
      await login(email, otpValue, requiresPolicy ? policyAccepted : undefined)
      await refreshCart()
      // Save channel preference + phone (for SMS/WhatsApp) asynchronously — non-blocking
      fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          notificationChannel: channel,
          ...(channel !== 'email' && loginPhone.length === 10 ? { phone: loginPhone } : {}),
        }),
      }).catch(() => {})
      router.push(redirect)
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
    if (step !== 'otp') return
    if (otp.length !== 6) return
    if (isLoading) return
    if (requiresPolicy && !policyAccepted) return
    submitLogin(otp)
  }, [otp, step, isLoading, requiresPolicy, policyAccepted])

  const handleResendOTP = async () => {
    setError('')
    setOtp('')
    submittedOtpRef.current = ''
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, phone: `+91${loginPhone}`, channel, isSignup: false }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 429 && typeof data.retryAfter === 'number') {
          setResendCooldown(data.retryAfter)
        }
        throw new Error(data.error || 'Failed to resend OTP')
      }
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 60)
      showToast('New OTP sent! Check your inbox for the latest code.', 'success')
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSavePhone = async (e: React.FormEvent) => {
    e.preventDefault()
    setPhoneError('')
    if (!phone || phone.length !== 10) {
      setPhoneError('Enter a valid 10-digit mobile number')
      return
    }
    if (phoneRequiresPolicy && !phonePolicyAccepted) {
      setPhoneError('Please accept the Privacy Policy and Terms & Conditions')
      return
    }
    setPhoneSaving(true)
    try {
      const res = await fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Failed to save phone number')
      }
      if (phoneRequiresPolicy && phonePolicyAccepted) {
        await fetch('/api/user/accept-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        }).catch(() => {})
      }
      await refreshUser()
      router.push(redirect)
    } catch (err: any) {
      setPhoneError(err.message)
    } finally {
      setPhoneSaving(false)
    }
  }

  const [smsEnabled, setSmsEnabled] = useState(process.env.NEXT_PUBLIC_SMS_DISABLED !== 'true')
  const [whatsappEnabled, setWhatsappEnabled] = useState(process.env.NEXT_PUBLIC_WHATSAPP_DISABLED !== 'true')

  useEffect(() => {
    fetch('/api/feature-flags').then(r => r.json()).then(f => {
      setSmsEnabled(f.smsEnabled ?? true)
      setWhatsappEnabled(f.whatsappEnabled ?? true)
    }).catch(() => {})
  }, [])

  const allChannelOptions = [
    {
      id: 'email' as const,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
      label: 'Email',
      enabled: true,
    },
    {
      id: 'sms' as const,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3" />
        </svg>
      ),
      label: 'SMS',
      enabled: smsEnabled,
    },
    {
      id: 'whatsapp' as const,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
        </svg>
      ),
      label: 'WhatsApp',
      enabled: whatsappEnabled,
    },
  ]
  const channelOptions = allChannelOptions.filter(o => o.enabled)

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-surface-elevated rounded-lg shadow-lg p-4 sm:p-6 lg:p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-foreground">Welcome Back</h2>
            <p className="mt-2 text-sm text-foreground-secondary">
              Login to your {config.identity.name} account
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <>
              <button
                type="button"
                onClick={handleGoogleButtonClick}
                disabled={googleLoading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border-secondary bg-surface hover:bg-surface-secondary transition-colors text-sm font-medium text-foreground disabled:opacity-60 disabled:cursor-not-allowed mb-4"
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
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border-default" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-surface-elevated text-foreground-muted">or continue with email</span>
                </div>
              </div>
            </>
          )}

          {step === 'email' && (
            <form onSubmit={handleSendOTP} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Email Address
                </label>
                <input
                  id="email" type="email" required value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                  placeholder="your@email.com"
                />
              </div>

              {/* Inline channel selector */}
              <div>
                <p className="text-sm font-medium text-foreground-secondary mb-2">
                  Send OTP via
                </p>
                <div className="flex gap-2">
                  {channelOptions.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedChannel(opt.id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                        selectedChannel === opt.id
                          ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/20 text-accent-600 dark:text-accent-400'
                          : 'border-border-secondary bg-surface text-foreground-secondary hover:border-accent-400 hover:text-foreground'
                      }`}
                    >
                      <span className="shrink-0">{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditional phone input */}
              {(selectedChannel === 'sms' || selectedChannel === 'whatsapp') && (
                <div>
                  <label htmlFor="login-phone" className="block text-sm font-medium text-foreground-secondary mb-2">
                    Mobile Number
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-4 py-3 border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary text-foreground-secondary text-sm font-medium">
                      +91
                    </span>
                    <input
                      id="login-phone"
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={loginPhone}
                      onChange={e => setLoginPhone(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-4 py-3 border border-border-secondary rounded-r-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                      placeholder="10-digit number"
                      autoFocus
                    />
                  </div>
                  {loginPhone.length > 0 && loginPhone.length !== 10 && (
                    <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
                  )}
                </div>
              )}

              <button type="submit" disabled={isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? (
                  <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Sending OTP...</>
                ) : 'Continue'}
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  {channel === 'email' && <>We&apos;ve sent a 6-digit verification code to <strong>{email}</strong></>}
                  {channel === 'sms' && <>We&apos;ve sent a 6-digit verification code via SMS to <strong>+91 ••••• {loginPhone.slice(-4)}</strong></>}
                  {channel === 'whatsapp' && <>We&apos;ve sent a 6-digit verification code via WhatsApp to <strong>+91 ••••• {loginPhone.slice(-4)}</strong></>}
                </p>
              </div>
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Verification Code
                </label>
                <input
                  id="otp" type="text" required maxLength={6} value={otp}
                  ref={otpInputRef}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  className={`w-full px-4 py-3 border rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500 text-center text-2xl tracking-widest transition-all ${
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
                  className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                </button>
                <button type="button" onClick={() => { setStep('email'); setOtp(''); submittedOtpRef.current = '' }}
                  className="text-foreground-secondary hover:text-foreground">
                  Change Channel
                </button>
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
                    <a href="/legal/privacy-policy" target="_blank" rel="noopener" className="text-accent-500 hover:underline font-medium">Privacy Policy</a>{' '}and{' '}
                    <a href="/legal/terms-and-conditions" target="_blank" rel="noopener" className="text-accent-500 hover:underline font-medium">Terms &amp; Conditions</a>.
                  </span>
                </label>
              )}
              <button type="submit" disabled={otp.length !== 6 || isLoading || (requiresPolicy && !policyAccepted)}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? (
                  <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Logging in...</>
                ) : 'Login'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-foreground-secondary">
            Don&apos;t have an account?{' '}
            <Link href={`/signup${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">
              Create one
            </Link>
          </div>
        </div>
      </div>

      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-surface-elevated rounded-lg shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {phoneRequiresPolicy ? 'Almost there' : 'Add Mobile Number'}
            </h3>
            <p className="text-sm text-foreground-secondary mb-6">
              Add your mobile number{phoneRequiresPolicy ? ' and accept our policies' : ''} so we can keep you updated on your orders.
            </p>
            {phoneError && (
              <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-sm">
                {phoneError}
              </div>
            )}
            <form onSubmit={handleSavePhone} className="space-y-4">
              <div>
                <label htmlFor="phone-modal" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Mobile Number *
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-4 py-3 border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary text-foreground-secondary text-sm font-medium">
                    +91
                  </span>
                  <input
                    id="phone-modal"
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
              {phoneRequiresPolicy && (
                <label className="flex items-start gap-2 text-sm text-foreground-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={phonePolicyAccepted}
                    onChange={e => setPhonePolicyAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-accent-500 cursor-pointer"
                  />
                  <span>
                    I agree to the{' '}
                    <a href="/legal/privacy-policy" target="_blank" rel="noopener" className="text-accent-500 hover:underline font-medium">Privacy Policy</a>{' '}and{' '}
                    <a href="/legal/terms-and-conditions" target="_blank" rel="noopener" className="text-accent-500 hover:underline font-medium">Terms &amp; Conditions</a>.
                  </span>
                </label>
              )}
              <button
                type="submit"
                disabled={phoneSaving || phone.length !== 10 || (phoneRequiresPolicy && !phonePolicyAccepted)}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {phoneSaving ? (
                  <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Saving...</>
                ) : 'Save & Continue'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
