'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { openGoogleOAuthPopup } from '@/lib/google-oauth-popup'
import AdminSelect from '@/components/admin/AdminSelect'
import { bp } from '@/lib/business-path'
import BusinessPublicHeader from '@/components/business/PublicHeader'

export default function BusinessSignUpWrapper() {
  return (
    <Suspense>
      <BusinessSignUpPage />
    </Suspense>
  )
}

function BusinessSignUpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [step, setStep] = useState<'email' | 'otp' | 'details'>('email')
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const otpInputRef = useRef<HTMLInputElement>(null)
  const submittedOtpRef = useRef<string>('')

  const googleAccessToken = searchParams.get('token')
  const isGoogleFlow = searchParams.get('google') === '1' && !!googleAccessToken

  useEffect(() => {
    if (isGoogleFlow) setStep('details')
  }, [isGoogleFlow])

  // Business details
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [industry, setIndustry] = useState('')

  // Structured address
  const [addressLine1, setAddressLine1] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [pinLookupState, setPinLookupState] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const [locality, setLocality] = useState('')
  const [landmark, setLandmark] = useState('')
  const [city, setCity] = useState('')
  const [addrState, setAddrState] = useState('')
  const pinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const handlePinChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6)
    setPinCode(digits)
    if (digits.length < 6) {
      setPinLookupState('idle')
      setLocalities([])
      setLocality('')
      setCity('')
      setAddrState('')
      return
    }
    if (pinDebounceRef.current) clearTimeout(pinDebounceRef.current)
    pinDebounceRef.current = setTimeout(async () => {
      setPinLookupState('loading')
      try {
        const res = await fetch(`/api/pincode/${digits}`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        setCity(data.district || '')
        setAddrState(data.state || '')
        const offices: string[] = (data.postOffices || []).filter(Boolean)
        setLocalities(offices)
        setLocality(offices[0] || '')
        setPinLookupState('found')
      } catch {
        setPinLookupState('error')
        setCity('')
        setAddrState('')
        setLocalities([])
        setLocality('')
      }
    }, 400)
  }

  const buildBusinessAddress = () =>
    [addressLine1, locality, landmark, city, addrState, pinCode]
      .map(s => s.trim())
      .filter(Boolean)
      .join(', ')

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, isSignup: true, userType: 'business' }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number') {
          setResendCooldown(data.retryAfter)
          setStep('otp')
          throw new Error(data.error || 'Please wait before requesting another OTP')
        }
        if (data.userExists) {
          router.push(`${bp('/business/signin')}?email=${encodeURIComponent(email)}`)
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

  const handleVerifyOTP = async (otpValue: string) => {
    if (submittedOtpRef.current === otpValue) return
    if (!policyAccepted) return
    submittedOtpRef.current = otpValue
    setError('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, otp: otpValue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid OTP')
      setStep('details')
    } catch (err: any) {
      setError(err.message)
      setOtp('')
      submittedOtpRef.current = ''
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } finally {
      setIsLoading(false)
    }
  }

  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length === 6) await handleVerifyOTP(otp)
  }

  useEffect(() => {
    if (step !== 'otp' || otp.length !== 6 || isLoading) return
    if (!policyAccepted) return
    handleVerifyOTP(otp)
  }, [otp, step, isLoading, policyAccepted])

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
        body: JSON.stringify({ email, isSignup: true, userType: 'business' }),
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

  const handleGoogleSignUp = async () => {
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
    router.push(`${bp('/business/signup')}?google=1&token=${result.accessToken}`)
  }

  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (pinCode.length !== 6) { setError('Enter a valid 6-digit PIN code'); return }
    if (!city.trim() || !addrState.trim()) { setError('PIN code lookup failed — enter city and state manually'); return }
    if (!companyName.trim()) { setError('Company name is required'); return }
    if (!gstNumber.trim()) { setError('GST number is required'); return }
    if (!industry.trim()) { setError('Please select an industry'); return }
    if (!isGoogleFlow) {
      if (!firstName.trim()) { setError('First name is required'); return }
      if (phone.length !== 10) { setError('Enter a valid 10-digit mobile number'); return }
    }
    const businessAddress = buildBusinessAddress()
    setIsLoading(true)
    try {
      let res: Response
      if (isGoogleFlow) {
        res = await fetch('/api/business/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken: googleAccessToken, companyName, gstNumber, businessAddress, industry }),
        })
      } else {
        res = await fetch('/api/business/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, otp, firstName, lastName, phone, companyName, gstNumber, businessAddress, industry }),
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Signup failed')
      router.push(bp('/business/pending'))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const industries = [
    'Manufacturing', 'Construction', 'Solar & Renewable Energy',
    'Electronics & Electrical', 'Retail & Distribution', 'Engineering & Fabrication',
    'Agriculture', 'Education', 'Government', 'Healthcare', 'IT & Technology', 'Other',
  ]

  const inputCls = 'w-full px-3 py-2.5 border border-border-secondary rounded-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500'

  return (
    <>
    <BusinessPublicHeader />
    <div className="min-h-screen grid lg:grid-cols-2 pt-16 lg:pt-20">
      {/* Left — form */}
      <div className="flex items-center justify-center px-6 py-12 bg-surface">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <Link href={bp('/business/signin')} className="text-sm text-foreground-muted hover:text-foreground mb-6 flex items-center gap-1">
              ← Back to sign in
            </Link>
            <h1 className="text-3xl font-bold text-foreground">
              {step === 'details' ? 'Business Details' : 'Business Sign Up'}
            </h1>
            <p className="text-sm text-foreground-secondary mt-2">
              {step === 'details'
                ? 'Tell us about your business — our team will review your application.'
                : 'Create a business partner account to access exclusive pricing.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Step: Email */}
          {step === 'email' && (
            <>
              {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                <>
                  <button
                    type="button"
                    onClick={handleGoogleSignUp}
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
                    {googleLoading ? 'Please wait…' : 'Continue with Google'}
                  </button>
                  <div className="relative mb-5">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border-default" /></div>
                    <div className="relative flex justify-center text-xs"><span className="px-3 bg-surface text-foreground-muted">or continue with email</span></div>
                  </div>
                </>
              )}
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
                  className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
                  {isLoading ? <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Sending…</> : 'Send Verification Code'}
                </button>
              </form>
              <p className="mt-6 text-sm text-center text-foreground-secondary">
                Already have an account?{' '}
                <Link href={bp('/business/signin')} className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">Sign in</Link>
              </p>
            </>
          )}

          {/* Step: OTP */}
          {step === 'otp' && (
            <form onSubmit={handleOTPSubmit} className="space-y-5">
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
                  className="text-accent-600 dark:text-accent-400 font-medium disabled:opacity-50">
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                </button>
                <button type="button" onClick={() => { setStep('email'); setOtp(''); submittedOtpRef.current = '' }}
                  className="text-foreground-secondary hover:text-foreground">
                  Change Email
                </button>
              </div>
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
              <button type="submit" disabled={otp.length !== 6 || isLoading || !policyAccepted}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center">
                {isLoading ? <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Verifying…</> : 'Verify Email'}
              </button>
            </form>
          )}

          {/* Step: Business Details */}
          {step === 'details' && (
            <form onSubmit={handleDetailsSubmit} className="space-y-4">
              {!isGoogleFlow && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">First Name *</label>
                      <input type="text" required value={firstName} onChange={e => setFirstName(e.target.value)}
                        className={inputCls} placeholder="First" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground-secondary mb-1">Last Name</label>
                      <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
                        className={inputCls} placeholder="Last" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground-secondary mb-1">Mobile Number *</label>
                    <div className="flex">
                      <span className="inline-flex items-center px-3 py-2.5 border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary text-foreground-secondary text-sm">+91</span>
                      <input type="tel" inputMode="numeric" maxLength={10} value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                        className="w-full px-3 py-2.5 border border-border-secondary rounded-r-lg bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                        placeholder="00000 00000" />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Company Name *</label>
                <input type="text" required value={companyName} onChange={e => setCompanyName(e.target.value)}
                  className={inputCls} placeholder="Your Company Pvt. Ltd." />
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">GST Number *</label>
                <input type="text" required value={gstNumber} onChange={e => setGstNumber(e.target.value.toUpperCase())}
                  maxLength={15}
                  className={`${inputCls} font-mono tracking-wider`}
                  placeholder="22AAAAA0000A1Z5" />
              </div>

              {/* Structured address */}
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">PIN Code *</label>
                <div className="relative">
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    value={pinCode} onChange={e => handlePinChange(e.target.value)}
                    className={`${inputCls} pr-8`}
                    placeholder="6-digit PIN"
                  />
                  {pinLookupState === 'loading' && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {pinLookupState === 'found' && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-green-500">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {pinLookupState === 'error' && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                </div>
                {pinLookupState === 'error' && (
                  <p className="mt-1 text-xs text-red-500">PIN code not found — enter city and state below manually.</p>
                )}
              </div>

              {(pinLookupState === 'found' || pinLookupState === 'error') && (
              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Locality / Area</label>
                {localities.length > 0 ? (
                  <AdminSelect
                    value={locality}
                    onChange={setLocality}
                    placeholder="Select locality…"
                    options={localities.map(l => ({ value: l, label: l }))}
                    sm
                  />
                ) : (
                  <input type="text" value={locality} onChange={e => setLocality(e.target.value)}
                    className={inputCls} placeholder="Locality / area name" />
                )}
              </div>
              )}

              <div>
                <label className="block text-xs font-medium text-foreground-secondary mb-1">Landmark <span className="text-foreground-muted">(optional)</span></label>
                <input type="text" value={landmark} onChange={e => setLandmark(e.target.value)}
                  className={inputCls} placeholder="Near post office, opposite temple…" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">City *</label>
                  <input type="text" required value={city} onChange={e => setCity(e.target.value)}
                    readOnly={pinLookupState === 'found'}
                    className={`${inputCls} ${pinLookupState === 'found' ? 'bg-surface-secondary text-foreground-secondary' : ''}`}
                    placeholder="City" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground-secondary mb-1">State *</label>
                  <input type="text" required value={addrState} onChange={e => setAddrState(e.target.value)}
                    readOnly={pinLookupState === 'found'}
                    className={`${inputCls} ${pinLookupState === 'found' ? 'bg-surface-secondary text-foreground-secondary' : ''}`}
                    placeholder="State" />
                </div>
              </div>

              <div>
                <AdminSelect
                  label="Industry *"
                  required
                  value={industry}
                  onChange={setIndustry}
                  placeholder="Select industry…"
                  options={industries.map(i => ({ value: i, label: i }))}
                  sm
                />
              </div>

              <button type="submit" disabled={isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:opacity-60 flex items-center justify-center mt-2">
                {isLoading ? <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Submitting…</> : 'Submit Application'}
              </button>

              <p className="text-xs text-foreground-muted text-center">
                Your application will be reviewed by our team within 24–48 hours.
              </p>
            </form>
          )}
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
            Become a Jeffi Stores Business Partner
          </h2>
          <p className="text-white/70 text-base leading-relaxed mb-8">
            Get exclusive B2B pricing, dedicated support, and streamlined bulk ordering for your business.
          </p>
          <div className="space-y-4">
            {[
              { step: '1', title: 'Fill your details', desc: 'Company info, GST, and industry' },
              { step: '2', title: 'Admin review', desc: 'Our team approves within 24–48 hours' },
              { step: '3', title: 'Access partner portal', desc: 'Discounts and RFQ tools unlocked' },
            ].map(item => (
              <div key={item.step} className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-sm font-bold">
                  {item.step}
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">{item.title}</p>
                  <p className="text-white/60 text-xs mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
