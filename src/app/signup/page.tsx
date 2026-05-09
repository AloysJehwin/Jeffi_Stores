'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { Suspense } from 'react'

export default function SignupPageWrapper() {
  return (
    <Suspense>
      <SignupPage />
    </Suspense>
  )
}

function SignupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromLogin = searchParams.get('from') === 'login'
  const prefillEmail = searchParams.get('email') || ''

  const { signup, googleLogin } = useAuth()
  const { refreshCart } = useCart()
  const { showToast } = useToast()

  const [step, setStep] = useState<'email' | 'otp' | 'details'>('email')
  const [email, setEmail] = useState(prefillEmail)
  const [otp, setOtp] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) return

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
      })
      window.google?.accounts.id.renderButton(
        document.getElementById('google-signup-btn')!,
        { type: 'standard', theme: 'outline', size: 'large', width: '100%', text: 'signup_with' }
      )
    }
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [])

  async function handleGoogleCredential(response: { credential: string }) {
    setGoogleLoading(true)
    setError('')
    try {
      await googleLogin(response.credential)
      await refreshCart()
      router.push('/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, isSignup: true }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send OTP')
      setStep('otp')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Invalid OTP')
      setStep('details')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (phone && phone.length !== 10) {
      setError('Enter a valid 10-digit mobile number')
      return
    }
    setIsLoading(true)
    try {
      await signup({ email, otp, firstName, lastName, phone })
      await refreshCart()
      router.push('/')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleResendOTP = async () => {
    setError('')
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, isSignup: true }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to resend OTP')
      showToast('OTP sent successfully!', 'success')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-surface-elevated rounded-lg shadow-lg p-4 sm:p-6 lg:p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-foreground">Create Account</h2>
            <p className="mt-2 text-sm text-foreground-secondary">
              Join Jeffi Stores for the best hardware deals
            </p>
          </div>

          {fromLogin && step === 'email' && (
            <div className="mb-6 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                No account found for <strong>{prefillEmail}</strong>. Create one to continue.
              </p>
            </div>
          )}

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {step === 'email' && process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
            <>
              <div id="google-signup-btn" className="w-full mb-4" />
              {googleLoading && (
                <p className="text-center text-sm text-foreground-secondary mb-4">Signing up with Google…</p>
              )}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border-default" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-surface-elevated text-foreground-muted">or sign up with email</span>
                </div>
              </div>
            </>
          )}

          {step === 'email' && (
            <form onSubmit={handleSendOTP} className="space-y-6">
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
              <button type="submit" disabled={isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? (
                  <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Sending OTP...</>
                ) : 'Send Verification Code'}
              </button>
            </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  We&apos;ve sent a 6-digit verification code to <strong>{email}</strong>
                </p>
              </div>
              <div>
                <label htmlFor="otp" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Verification Code
                </label>
                <input
                  id="otp" type="text" required maxLength={6} value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500 text-center text-2xl tracking-widest"
                  placeholder="000000"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={handleResendOTP} disabled={isLoading}
                  className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">
                  Resend Code
                </button>
                <button type="button" onClick={() => setStep('email')}
                  className="text-foreground-secondary hover:text-foreground">
                  Change Email
                </button>
              </div>
              <button type="submit" disabled={otp.length !== 6 || isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? (
                  <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Verifying...</>
                ) : 'Verify & Continue'}
              </button>
            </form>
          )}

          {step === 'details' && (
            <form onSubmit={handleSignup} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-foreground-secondary mb-2">
                    First Name *
                  </label>
                  <input id="firstName" type="text" required value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                    placeholder="John" />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-foreground-secondary mb-2">
                    Last Name
                  </label>
                  <input id="lastName" type="text" value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                    placeholder="Doe" />
                </div>
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Phone Number
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-4 py-3 border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary text-foreground-secondary text-sm font-medium">
                    +91
                  </span>
                  <input id="phone" type="tel" inputMode="numeric" maxLength={10} value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-3 border border-border-secondary rounded-r-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-accent-500"
                    placeholder="98765 43210" />
                </div>
                {phone && phone.length > 0 && phone.length !== 10 && (
                  <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
                )}
              </div>
              <button type="submit" disabled={isLoading}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? (
                  <><div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full mr-2" />Creating Account...</>
                ) : 'Complete Signup'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-foreground-secondary">
            Already have an account?{' '}
            <Link href="/login" className="text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium">
              Login here
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
