'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { openGoogleOAuthPopup } from '@/lib/client/google-oauth-popup'
import SocialSignInButtons from '@/components/auth/SocialSignInButtons'
import { oauthErrorMessage } from '@/lib/auth/social/types'
import { bp, businessReturnPath } from '@/lib/shared/business-path'
import AuthSplitShell, { AUTH_POINTS, AUTH_THEMES } from '@/components/auth/AuthSplitShell'
import { useLeaveTo } from '@/components/auth/useLeaveTo'
import { useMessagingChannels } from '@/hooks/useStoreFlags'
import { BusinessAuthSkeleton } from '@/components/visitor/skeletons/auth'

export default function BusinessSignInWrapper() {
  return (
    <Suspense fallback={<BusinessAuthSkeleton kind="signin" />}>
      <BusinessSignInPage />
    </Suspense>
  )
}

function BusinessSignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, isLoading: authLoading } = useAuth()
  const config = useStoreConfig()
  const { leaving, go } = useLeaveTo()
  // Which button started the sign-in, so that one keeps its spinner until the next page opens.
  const via = useRef<'google' | 'form' | null>(null)

  // Where the visitor was headed; checkout and account pages send ?redirect=, middleware ?callbackUrl=.
  const returnTo = businessReturnPath(searchParams.get('callbackUrl') ?? searchParams.get('redirect'))

  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [email, setEmail] = useState('')
  const [loginPhone, setLoginPhone] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<'email' | 'sms' | 'whatsapp'>('email')
  const [channel, setChannel] = useState<'email' | 'sms' | 'whatsapp'>('email')
  // SMS / WhatsApp only while their Site Controls switch is on.
  const channelsOn = useMessagingChannels()
  useEffect(() => {
    if ((selectedChannel === 'sms' && !channelsOn.sms) || (selectedChannel === 'whatsapp' && !channelsOn.whatsapp))
      setSelectedChannel('email')
  }, [selectedChannel, channelsOn.sms, channelsOn.whatsapp])
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState(oauthErrorMessage(searchParams.get('oauth_error')))
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

  // Back from a provider sign-in (?oauth=done): the same phone / policy prompts as the Google flow.
  const oauthDone = searchParams.get('oauth') === 'done'
  const oauthChecked = useRef(false)

  useEffect(() => {
    if (authLoading || !user?.isBusiness) return
    if (user.approvalStatus === 'pending') {
      go(bp('/business/pending'), 'replace')
      return
    }
    if (user.approvalStatus !== 'approved' || showPhoneModal) return
    if (oauthDone && !oauthChecked.current) {
      oauthChecked.current = true
      const needsPolicy = !!user.requiresPolicyAcceptance
      if (!user.phone || needsPolicy) {
        setPhoneRequiresPolicy(needsPolicy)
        setPhonePolicyAccepted(false)
        setShowPhoneModal(true)
        return
      }
    }
    go(returnTo, 'replace')
  }, [user, authLoading, go, returnTo, oauthDone, showPhoneModal])

  const rejectedParam = searchParams.get('rejected')
  const noticeParam = searchParams.get('notice')

  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) setEmail(decodeURIComponent(emailParam))
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // The token rides via sessionStorage, never the URL.
  function goToBusinessGoogleSignup(
    accessToken: string,
    profile: { email: string; firstName: string; lastName: string }
  ) {
    try {
      sessionStorage.setItem('business_google_signup', JSON.stringify({ accessToken, profile }))
    } catch {}
    router.push(`${bp('/business/signup')}?google=1`)
  }

  // Hash fallback: popup blocked → callback redirects back here with access_token in hash.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    if (!accessToken) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setError('')
    via.current = 'google'
    setGoogleLoading(true)
    fetch('/api/business/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accessToken }),
    })
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Google sign-in failed')
        if (data.newUser) {
          goToBusinessGoogleSignup(accessToken, data.profile)
          return
        }
        if (data.approvalStatus === 'pending') {
          go(bp('/business/pending'))
          return
        }
        go(returnTo, 'hard')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Google sign-in failed'))
      .finally(() => setGoogleLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (selectedChannel !== 'email' && loginPhone.length !== 10) {
      setError('Enter a valid 10-digit mobile number')
      return
    }
    via.current = 'form'
    setIsLoading(true)
    setChannel(selectedChannel)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          phone: `+91${loginPhone}`,
          channel: selectedChannel,
          isSignup: false,
          userType: 'business',
        }),
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
    via.current = 'form'
    setIsLoading(true)
    try {
      const res = await fetch('/api/business/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, otp: otpValue, policiesAccepted: requiresPolicy ? policyAccepted : undefined }),
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
        go(bp('/business/pending'))
        return
      }
      if (data.approvalStatus === 'rejected') {
        setError('Your business account application was not approved. Please contact support.')
        setOtp('')
        submittedOtpRef.current = ''
        return
      }
      // Save channel preference asynchronously — non-blocking
      fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Portal': 'business' },
        credentials: 'include',
        body: JSON.stringify({ notificationChannel: channel }),
      }).catch(() => {})
      // Redirect to business portal
      go(returnTo, 'hard')
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
    if (requiresPolicy && !policyAccepted) return
    submitLogin(otp)
  }, [otp, step, isLoading, requiresPolicy, policyAccepted])

  const handleResendOTP = async () => {
    setError('')
    setOtp('')
    submittedOtpRef.current = ''
    via.current = 'form'
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, phone: `+91${loginPhone}`, channel, isSignup: false, userType: 'business' }),
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
    if (!clientId) {
      setError('Google sign-in is not configured')
      return
    }
    via.current = 'google'
    setGoogleLoading(true)
    const result = await openGoogleOAuthPopup({ clientId, returnTo: bp('/business/signin') })
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

      if (data.newUser) {
        goToBusinessGoogleSignup(result.accessToken, data.profile)
        return
      }
      if (data.approvalStatus === 'pending') {
        go(bp('/business/pending'))
        return
      }
      // Fetch business profile to know if policy acceptance is needed
      let needsPolicy = false
      try {
        const meRes = await fetch('/api/business/me', {
          credentials: 'include',
          headers: { 'X-Auth-Portal': 'business' },
        })
        if (meRes.ok) {
          const meData = await meRes.json()
          needsPolicy = !!meData?.user?.requiresPolicyAcceptance
        }
      } catch {}
      const needsPhone = !data.phone
      if (needsPhone || needsPolicy) {
        setPhoneRequiresPolicy(needsPolicy)
        setPhonePolicyAccepted(false)
        setShowPhoneModal(true)
        return
      }
      go(returnTo, 'hard')
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
    if (phoneRequiresPolicy && !phonePolicyAccepted) {
      setPhoneError('Please accept the Privacy Policy and Terms & Conditions')
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
      if (phoneRequiresPolicy && phonePolicyAccepted) {
        await fetch('/api/user/accept-policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Portal': 'business' },
          credentials: 'include',
          body: JSON.stringify({}),
        }).catch(() => {})
      }
      go(returnTo, 'hard')
    } catch (err: any) {
      setPhoneError(err.message)
    } finally {
      setPhoneSaving(false)
    }
  }

  const channelOptions = [
    {
      id: 'email' as const,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      ),
      label: 'Email',
    },
    {
      id: 'sms' as const,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3"
          />
        </svg>
      ),
      label: 'SMS',
    },
    {
      id: 'whatsapp' as const,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
          />
        </svg>
      ),
      label: 'Business WhatsApp',
    },
  ].filter(o => o.id === 'email' || (o.id === 'sms' ? channelsOn.sms : channelsOn.whatsapp))

  const googleBusy = googleLoading || (leaving && via.current === 'google')
  const formBusy = isLoading || (leaving && via.current === 'form')

  return (
    <>
      <AuthSplitShell
        brandName={config.identity.name}
        logoUrl={config.identity.logoUrl}
        headline="Your exclusive B2B partner portal"
        sub="Access custom pricing, request quotes on bulk orders, and manage your business purchases, all in one place."
        points={AUTH_POINTS.business}
        footnote="Business accounts are reviewed before trade pricing is unlocked."
        theme={AUTH_THEMES.business}
        corner={
          <>
          <span className="hidden sm:inline-flex items-center text-sm text-foreground-secondary bg-surface/90 backdrop-blur px-3 py-2 rounded-lg border border-border-default">
            New business partner?
          </span>
          <Link
            href={bp('/business/signup')}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors shadow-sm"
          >
            Sign up
          </Link>
          </>
        }
      >
            <div className="mb-8">
              <Link
                href="/"
                className="text-sm text-foreground-muted hover:text-foreground mb-6 flex items-center gap-1"
              >
                ← Back to store
              </Link>
              <h1 className="text-3xl font-bold text-foreground">Business Sign In</h1>
              <p className="text-sm text-foreground-secondary mt-2">
                Access your {config.identity.name} business partner account
              </p>
            </div>

            {rejectedParam && (
              <div className="mb-5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
                Your business account application was not approved. Please contact support.
              </div>
            )}

            {noticeParam === 'already_registered' && (
              <div className="mb-5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-4 py-3 rounded-lg text-sm">
                You already have a business account. Please sign in below.
              </div>
            )}

            {error && (
              <div className="mb-5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <SocialSignInButtons
              portal="business"
              redirect={returnTo !== bp('/business') ? returnTo : undefined}
              onGooglePlatform={handleGoogleSignIn}
              googleBusy={googleBusy}
              className="mb-5"
            >
              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border-default" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-surface text-foreground-muted">or continue with email</span>
                </div>
              </div>
            </SocialSignInButtons>

            {step === 'email' && (
              <form onSubmit={handleSendOTP} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1.5">Business Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                    placeholder="you@company.com"
                  />
                </div>

                {/* Inline channel selector */}
                {channelOptions.length > 1 && (
                <div>
                  <p className="text-sm font-medium text-foreground-secondary mb-1.5">Send OTP via</p>
                  <div className="flex gap-2">
                    {channelOptions.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSelectedChannel(opt.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg border-2 text-xs font-medium transition-colors ${
                          selectedChannel === opt.id
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/20 text-accent-600 dark:text-accent-400'
                            : 'border-border-secondary bg-surface text-foreground-secondary hover:border-accent-400 hover:text-foreground'
                        }`}
                      >
                        <span className="shrink-0">{opt.icon}</span>
                        <span className="leading-tight text-center">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                )}

                {/* Conditional phone input */}
                {(selectedChannel === 'sms' || selectedChannel === 'whatsapp') && (
                  <div>
                    <label
                      htmlFor="b-login-phone"
                      className="block text-sm font-medium text-foreground-secondary mb-1.5"
                    >
                      Mobile Number
                    </label>
                    <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-accent-500 focus-within:border-accent-500">
                      <span className="px-3 py-3 bg-surface-secondary text-foreground-secondary text-sm border-r border-border-secondary">
                        +91
                      </span>
                      <input
                        id="b-login-phone"
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={loginPhone}
                        onChange={e => setLoginPhone(e.target.value.replace(/\D/g, ''))}
                        placeholder="10-digit mobile number"
                        autoFocus
                        className="flex-1 px-3 py-3 bg-transparent text-foreground placeholder:text-foreground-muted focus:outline-none text-sm"
                      />
                    </div>
                    {loginPhone.length > 0 && loginPhone.length !== 10 && (
                      <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={formBusy}
                  className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {formBusy ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                      Sending…
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            )}

            {step === 'otp' && (
              <form onSubmit={handleLogin} className="space-y-5">
                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    {channel === 'email' && (
                      <>
                        We&apos;ve sent a 6-digit code to <strong>{email}</strong>
                      </>
                    )}
                    {channel === 'sms' && (
                      <>
                        We&apos;ve sent a 6-digit code via SMS to <strong>+91 ••••• {loginPhone.slice(-4)}</strong>
                      </>
                    )}
                    {channel === 'whatsapp' && (
                      <>
                        We&apos;ve sent a 6-digit code via Business WhatsApp to{' '}
                        <strong>+91 ••••• {loginPhone.slice(-4)}</strong>
                      </>
                    )}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otp}
                    ref={otpInputRef}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    className={`w-full px-4 py-3 border rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-accent-500 text-center text-2xl tracking-widest ${
                      otp.length === 6
                        ? 'border-green-500 ring-2 ring-green-200 dark:ring-green-900/40'
                        : 'border-border-secondary'
                    }`}
                    placeholder="000000"
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handleResendOTP}
                    disabled={formBusy || resendCooldown > 0}
                    className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium disabled:opacity-50"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('email')
                      setOtp('')
                      submittedOtpRef.current = ''
                    }}
                    className="text-foreground-secondary hover:text-foreground"
                  >
                    {channelOptions.length > 1 ? 'Change Channel' : 'Change email'}
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
                  disabled={otp.length !== 6 || formBusy || (requiresPolicy && !policyAccepted)}
                  className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center"
                >
                  {formBusy ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />
                      Signing in…
                    </>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>
            )}

            <p className="mt-6 text-sm text-center text-foreground-secondary">
              New business partner?{' '}
              <Link
                href={bp('/business/signup')}
                className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium"
              >
                Apply for access
              </Link>
            </p>
      </AuthSplitShell>

      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">
              {phoneRequiresPolicy ? 'Almost there' : 'One last step'}
            </h2>
            <p className="text-sm text-foreground-secondary mb-5">
              Please enter your mobile number{phoneRequiresPolicy ? ' and accept our policies' : ''} to complete
              sign-in.
            </p>
            {phoneError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{phoneError}</p>}
            <form onSubmit={handleSavePhone} className="space-y-4">
              <div>
                <label htmlFor="phone-modal-b" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Mobile Number
                </label>
                <div className="flex items-center border border-border-secondary rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-accent-500 focus-within:border-accent-500">
                  <span className="px-3 py-3 bg-surface-secondary text-foreground-secondary text-sm border-r border-border-secondary">
                    +91
                  </span>
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
                disabled={phoneSaving || phone.length !== 10 || (phoneRequiresPolicy && !phonePolicyAccepted)}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center text-sm"
              >
                {phoneSaving ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                    Saving…
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
