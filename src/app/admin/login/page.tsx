'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { openGoogleOAuthPopup } from '@/lib/google-oauth-popup'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

type Step = 'identity' | 'verify' | 'enroll'

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

export default function AdminLogin() {
  const { name: storeName, web: storeWeb } = useStoreConfig().identity
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || ap('/admin/dashboard')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [step, setStep] = useState<Step>('identity')
  const [ticket, setTicket] = useState('')
  const [code, setCode] = useState('')
  const [enrollData, setEnrollData] = useState<{ secret: string; qr_data_url: string; otpauth_url: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [isCertError, setIsCertError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [certStatus, setCertStatus] = useState<'checking' | 'verified' | 'development' | 'not_found'>('checking')

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/admin/check-session')
        const data = await response.json()
        setCertStatus(
          data.certStatus === 'valid' ? 'verified'
            : data.certStatus === 'development' ? 'development'
            : 'not_found'
        )
        if (data.authenticated) {
          router.push(callbackUrl)
          return
        }
      } catch {
        setCertStatus('not_found')
      }
      setCheckingSession(false)
    }
    checkSession()
  }, [router])

  // Shared: both identity factors (email-OTP, Google) return {mfa_required|enroll_required, ticket}.
  const handleIdentityResult = async (data: { mfa_required?: boolean; enroll_required?: boolean; ticket?: string }) => {
    if (data.mfa_required && data.ticket) {
      setTicket(data.ticket)
      setStep('verify')
      return
    }
    if (data.enroll_required && data.ticket) {
      setTicket(data.ticket)
      const startRes = await fetch('/api/admin/mfa/enroll-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: data.ticket }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error || 'Could not start enrollment')
      setEnrollData({ secret: startData.secret, qr_data_url: startData.qr_data_url, otpauth_url: startData.otpauth_url })
      setStep('enroll')
      return
    }
    throw new Error('Unexpected response')
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setIsCertError(false); setLoading(true)
    try {
      const res = await fetch('/api/admin/auth/email-otp/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 403) setIsCertError(true)
        throw new Error(data.error || 'Could not send code')
      }
      setOtpSent(true)
      setResendCooldown(data.nextCooldown || 30)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setIsCertError(false); setLoading(true)
    try {
      const res = await fetch('/api/admin/auth/email-otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), code: otp.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 403) setIsCertError(true)
        throw new Error(data.error || 'Verification failed')
      }
      await handleIdentityResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  // Exchange a Google access token for an MFA ticket (shared by popup flow and
  // the URL-hash fallback below).
  const exchangeGoogleToken = async (accessToken: string) => {
    const res = await fetch('/api/admin/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accessToken }),
    })
    const data = await res.json()
    if (!res.ok) {
      if (res.status === 403) setIsCertError(true)
      throw new Error(data.error || 'Google sign-in failed')
    }
    await handleIdentityResult(data)
  }

  const handleGoogle = async () => {
    setError(''); setIsCertError(false); setGoogleLoading(true)
    try {
      const { accessToken, error: gErr } = await openGoogleOAuthPopup({ clientId: GOOGLE_CLIENT_ID, returnTo: '/admin/login' })
      if (gErr || !accessToken) {
        if (gErr && gErr !== 'popup_closed') setError(gErr)
        return
      }
      await exchangeGoogleToken(accessToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  // Fallback for when Google's implicit flow returns to this page in the top-level
  // window (e.g. #access_token=... in the URL) instead of the popup — the callback
  // page's postMessage never reaches us. Detect the token in the hash on mount,
  // complete the exchange, and strip it from the URL so it isn't reprocessed or left
  // in history.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')
    const hashError = params.get('error')
    if (!accessToken && !hashError) return

    // Clear the hash immediately so a reload/re-render doesn't re-run this.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)

    if (hashError) {
      setError('Google sign-in failed. Please try again.')
      return
    }
    if (accessToken) {
      setError(''); setIsCertError(false); setGoogleLoading(true)
      exchangeGoogleToken(accessToken)
        .catch((err) => setError(err instanceof Error ? err.message : 'Google sign-in failed'))
        .finally(() => setGoogleLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed')
      window.location.href = callbackUrl
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
      setLoading(false)
    }
  }

  const handleEnrollConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!enrollData) return
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/mfa/enroll-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ticket, secret: enrollData.secret, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed')
      setRecoveryCodes(data.recovery_codes || [])
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
      setLoading(false)
    }
  }

  if (checkingSession) return null

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary-500 via-gray-800 to-secondary-500 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-5xl font-bold text-white mb-3">{storeName}</h1>
            <h2 className="text-2xl font-semibold text-white mb-2">Admin Panel</h2>
            <p className="text-gray-300">
              {step === 'identity' && 'Sign in to access the dashboard'}
              {step === 'verify' && 'Enter the 6-digit code from your authenticator app'}
              {step === 'enroll' && !recoveryCodes && 'Set up two-factor authentication'}
              {step === 'enroll' && recoveryCodes && 'Save these recovery codes — shown only once'}
            </p>
          </div>

          <div className="mb-6">
            <div
              className={`
                p-4 rounded-lg flex items-center gap-3 text-sm backdrop-blur-sm border
                ${
                  certStatus === 'verified'
                    ? 'bg-green-500/20 text-green-100 border-green-400/50'
                    : certStatus === 'development'
                    ? 'bg-yellow-500/20 text-yellow-100 border-yellow-400/50'
                    : certStatus === 'not_found'
                    ? 'bg-red-500/20 text-red-100 border-red-400/50'
                    : 'bg-gray-500/20 text-gray-100 border-gray-400/50'
                }
              `}
            >
              {certStatus === 'verified' && (
                <>
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                  </svg>
                  <span className="font-medium">Client Certificate Verified</span>
                </>
              )}
              {certStatus === 'development' && (
                <>
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                  </svg>
                  <span className="font-medium">Development Mode - Certificate Check Bypassed</span>
                </>
              )}
              {certStatus === 'not_found' && (
                <>
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                  </svg>
                  <span className="font-medium">Client Certificate Not Detected</span>
                </>
              )}
              {certStatus === 'checking' && (
                <>
                  <div className="w-5 h-5 flex-shrink-0 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"></div>
                  <span className="font-medium">Checking certificate...</span>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className={`mb-4 backdrop-blur-sm border rounded-lg p-4 flex items-start gap-3 ${
              isCertError
                ? 'bg-orange-500/20 border-orange-400/50 text-orange-100'
                : 'bg-red-500/20 border-red-400/50 text-red-100'
            }`}>
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
              </svg>
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}

          {step === 'identity' && (
            <div className="space-y-5">
              {GOOGLE_CLIENT_ID && (
                <>
                  <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={googleLoading || loading}
                    className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-lg border border-white/15 bg-black/30 hover:bg-black/40 transition-colors text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {googleLoading ? (
                      <div className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" />
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
                  <div className="flex items-center gap-3 text-gray-400 text-sm">
                    <div className="flex-1 h-px bg-white/20" />
                    <span>or</span>
                    <div className="flex-1 h-px bg-white/20" />
                  </div>
                </>
              )}

              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="space-y-6">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-white mb-2">Admin email</label>
                    <input
                      type="email" id="email" name="email"
                      value={email} onChange={(e) => setEmail(e.target.value)}
                      required autoFocus autoComplete="email"
                      className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all"
                      placeholder={`you@${storeWeb || 'example.com'}`}
                    />
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold py-4 px-6 rounded-lg transition-all disabled:cursor-not-allowed shadow-lg text-lg">
                    {loading ? 'Sending code…' : 'Send verification code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-6">
                  <div>
                    <label htmlFor="otp" className="block text-sm font-medium text-white mb-2">
                      Enter the code sent to <span className="text-white font-semibold">{email}</span>
                    </label>
                    <input
                      type="text" id="otp" name="otp"
                      value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required autoFocus inputMode="numeric" autoComplete="one-time-code"
                      className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all tracking-widest text-center text-xl"
                      placeholder="000000"
                    />
                  </div>
                  <button type="submit" disabled={loading || otp.length !== 6}
                    className="w-full bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold py-4 px-6 rounded-lg transition-all disabled:cursor-not-allowed shadow-lg text-lg">
                    {loading ? 'Verifying…' : 'Continue'}
                  </button>
                  <button type="button" onClick={() => { setOtpSent(false); setOtp(''); setError('') }}
                    className="w-full text-sm text-gray-300 hover:text-white">
                    ← Use a different email
                  </button>
                </form>
              )}
            </div>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-6">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-white mb-2">
                  6-digit code <span className="text-gray-300">or recovery code</span>
                </label>
                <input
                  type="text" id="code" name="code"
                  value={code} onChange={(e) => setCode(e.target.value)}
                  required autoFocus autoComplete="one-time-code" inputMode="text"
                  className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all tracking-widest text-center text-xl"
                  placeholder="000000"
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold py-4 px-6 rounded-lg transition-all disabled:cursor-not-allowed shadow-lg text-lg">
                {loading ? 'Verifying...' : 'Verify and Continue'}
              </button>
              <button type="button" onClick={() => { setStep('identity'); setOtpSent(false); setOtp(''); setCode(''); setError('') }}
                className="w-full text-sm text-gray-300 hover:text-white">
                ← Use a different account
              </button>
            </form>
          )}

          {step === 'enroll' && enrollData && !recoveryCodes && (
            <div className="space-y-5">
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-4 text-sm text-gray-100 space-y-3">
                <p>
                  Two-factor authentication is required for all admins. Open your authenticator app
                  (Google Authenticator, 1Password, Authy, etc.) and scan this QR code:
                </p>
                <div className="bg-white p-3 rounded-lg w-fit mx-auto">
                  <img src={enrollData.qr_data_url} alt="Scan to add to your authenticator" className="w-48 h-48" />
                </div>
                <p className="text-xs text-gray-300">
                  Can&apos;t scan? Enter this secret manually: <span className="font-mono text-white break-all">{enrollData.secret}</span>
                </p>
              </div>
              <form onSubmit={handleEnrollConfirm} className="space-y-4">
                <div>
                  <label htmlFor="enroll_code" className="block text-sm font-medium text-white mb-2">Enter the 6-digit code shown by your app</label>
                  <input
                    type="text" id="enroll_code" name="enroll_code"
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required autoFocus inputMode="numeric" autoComplete="one-time-code"
                    className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all tracking-widest text-center text-xl"
                    placeholder="000000"
                  />
                </div>
                <button type="submit" disabled={loading || code.length !== 6}
                  className="w-full bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-semibold py-4 px-6 rounded-lg transition-all disabled:cursor-not-allowed shadow-lg text-lg">
                  {loading ? 'Confirming...' : 'Confirm and Finish Setup'}
                </button>
              </form>
            </div>
          )}

          {step === 'enroll' && recoveryCodes && (
            <div className="space-y-5">
              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-4 text-sm text-gray-100 space-y-3">
                <p className="font-semibold text-white">Save these recovery codes now — they will not be shown again.</p>
                <p>
                  Use any one of these codes if you lose access to your authenticator. Each code works only once.
                  Store them in a password manager or print them.
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-white text-sm bg-black/40 p-3 rounded">
                  {recoveryCodes.map(c => <div key={c}>{c}</div>)}
                </div>
                <button type="button"
                  onClick={() => navigator.clipboard.writeText(recoveryCodes.join('\n'))}
                  className="text-xs text-accent-300 hover:text-accent-200 underline">
                  Copy all codes
                </button>
              </div>
              <button type="button"
                onClick={() => { window.location.href = callbackUrl }}
                className="w-full bg-gradient-to-r from-primary-500 to-accent-500 hover:from-primary-600 hover:to-accent-600 text-white font-semibold py-4 px-6 rounded-lg transition-all shadow-lg text-lg">
                I&apos;ve saved them — continue to dashboard
              </button>
            </div>
          )}

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-300 justify-center">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
              </svg>
              <span>Authorized Personnel Only</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-300 justify-center">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
              </svg>
              <span>All access is logged and monitored</span>
            </div>
          </div>
        </div>
    </div>
  )
}
