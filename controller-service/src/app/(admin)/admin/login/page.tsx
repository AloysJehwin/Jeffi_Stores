'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { openGoogleOAuthPopup } from '@/lib/client/google-oauth-popup'
import AuthSplitShell, { AUTH_POINTS, AUTH_THEMES } from '@/components/auth/AuthSplitShell'
import { useLeaveTo } from '@/components/auth/useLeaveTo'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

type Step = 'identity' | 'verify' | 'enroll'

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

export default function AdminLogin() {
  const { name: storeName, web: storeWeb, logoUrl } = useStoreConfig().identity
  const { leaving, go } = useLeaveTo()
  const searchParams = useSearchParams()
  const requested = searchParams.get('callbackUrl') || ''
  // Same-site paths only; a full URL here would turn the login page into an open redirect.
  const callbackUrl = /^\/(?![/\\])/.test(requested) ? requested : ap('/admin/dashboard')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [step, setStep] = useState<Step>('identity')
  const [ticket, setTicket] = useState('')
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [enrollData, setEnrollData] = useState<{ secret: string; qr_data_url: string; otpauth_url: string } | null>(
    null
  )
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
          data.certStatus === 'valid' ? 'verified' : data.certStatus === 'development' ? 'development' : 'not_found'
        )
        if (data.authenticated) {
          // A full load, not router.push: the shell-less login layout would otherwise persist into the panel.
          window.location.replace(callbackUrl)
          return
        }
      } catch {
        setCertStatus('not_found')
      }
      setCheckingSession(false)
    }
    checkSession()
  }, [callbackUrl])

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
      setEnrollData({
        secret: startData.secret,
        qr_data_url: startData.qr_data_url,
        otpauth_url: startData.otpauth_url,
      })
      setStep('enroll')
      return
    }
    throw new Error('Unexpected response')
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsCertError(false)
    setLoading(true)
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
    setError('')
    setIsCertError(false)
    setLoading(true)
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
    setError('')
    setIsCertError(false)
    setGoogleLoading(true)
    try {
      const { accessToken, error: gErr } = await openGoogleOAuthPopup({
        clientId: GOOGLE_CLIENT_ID,
        returnTo: ap('/admin/login'),
      })
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
      setError('')
      setIsCertError(false)
      setGoogleLoading(true)
      exchangeGoogleToken(accessToken)
        .catch(err => setError(err instanceof Error ? err.message : 'Google sign-in failed'))
        .finally(() => setGoogleLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick the resend cooldown down to 0 so the "Resend code" button re-enables.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown(s => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return
    setError('')
    setIsCertError(false)
    setLoading(true)
    try {
      const res = await fetch('/api/admin/auth/email-otp/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 429 && data.retryAfter) setResendCooldown(data.retryAfter)
        if (res.status === 403) setIsCertError(true)
        throw new Error(data.error || 'Could not resend code')
      }
      setOtp('')
      setResendCooldown(data.nextCooldown || 30)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code')
    } finally {
      setLoading(false)
    }
  }

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
      go(callbackUrl, 'hard')
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
    <AuthSplitShell
      brandName={storeName}
      logoUrl={logoUrl}
      headline={`Run ${storeName} from one place`}
      sub="The admin panel for orders, catalogue, customers and accounts."
      points={AUTH_POINTS.admin}
      footnote="Authorized personnel only. All access is logged and monitored."
      theme={AUTH_THEMES.admin}
      busy={leaving ? 'Opening the admin panel…' : googleLoading ? 'Signing you in with Google…' : null}
    >
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1">Admin Panel</h1>
          <p className="text-sm text-foreground-muted">
            {step === 'identity' && 'Sign in to access the dashboard'}
            {step === 'verify' && 'Enter the 6-digit code from your authenticator app'}
            {step === 'enroll' && !recoveryCodes && 'Set up two-factor authentication'}
            {step === 'enroll' && recoveryCodes && 'Save these recovery codes — shown only once'}
          </p>
        </div>

        <div className="mb-6">
          <div
            className={`
                px-4 py-3 rounded-lg flex items-center gap-3 text-sm border
                ${
                  certStatus === 'verified'
                    ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/40'
                    : certStatus === 'development'
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40'
                      : certStatus === 'not_found'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/40'
                        : 'bg-surface-secondary text-foreground-muted border-border-default'
                }
              `}
          >
            {certStatus === 'verified' && (
              <>
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">Client Certificate Verified</span>
              </>
            )}
            {certStatus === 'development' && (
              <>
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">Development Mode - Certificate Check Bypassed</span>
              </>
            )}
            {certStatus === 'not_found' && (
              <>
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">Client Certificate Not Detected</span>
              </>
            )}
            {certStatus === 'checking' && (
              <>
                <div className="w-5 h-5 flex-shrink-0 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin"></div>
                <span className="font-medium">Checking certificate...</span>
              </>
            )}
          </div>
        </div>

        {error && (
          <div
            className={`mb-4 border rounded-lg px-4 py-3 flex items-start gap-3 ${
              isCertError
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400'
                : 'bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-400'
            }`}
          >
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
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
                  className="control-md w-full gap-3 border border-border-default bg-surface-elevated hover:bg-surface-secondary transition-colors font-medium text-foreground disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {googleLoading ? (
                    <div className="w-5 h-5 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                  )}
                  {googleLoading ? 'Signing in…' : 'Continue with Google'}
                </button>
                <div className="flex items-center gap-3 text-foreground-muted text-sm">
                  <div className="flex-1 h-px bg-border-default" />
                  <span>or</span>
                  <div className="flex-1 h-px bg-border-default" />
                </div>
              </>
            )}

            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-6">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                    Admin email
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                    className="field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors"
                    placeholder={`you@${storeWeb || 'example.com'}`}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="control-md w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                >
                  {loading ? 'Sending code…' : 'Send verification code'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-foreground mb-1.5">
                    Enter the 6-digit code sent to <span className="text-foreground font-semibold break-words">{email}</span>
                  </label>
                  <input
                    type="text"
                    id="otp"
                    name="otp"
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors tracking-widest text-center text-xl"
                    placeholder="000000"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="control-md w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                >
                  {loading ? 'Verifying…' : 'Continue'}
                </button>
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false)
                      setOtp('')
                      setError('')
                    }}
                    className="text-foreground-muted hover:text-foreground"
                  >
                    ← Use a different email
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendCooldown > 0 || loading}
                    className="text-foreground-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </div>
                <p className="text-center text-xs text-foreground-muted">
                  Didn&apos;t get the email? Check spam, or wait a moment and resend.
                </p>
              </form>
            )}
          </div>
        )}

        {step === 'verify' && (
          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-foreground mb-1.5">
                {useRecovery ? 'Enter a recovery code' : 'Enter the 6-digit code from your authenticator app'}
              </label>
              <input
                type="text"
                id="code"
                name="code"
                value={code}
                onChange={e => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                className={`field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors text-center text-xl ${useRecovery ? 'font-mono' : 'tracking-widest'}`}
                placeholder={useRecovery ? 'xxxx-xxxx' : '000000'}
              />
            </div>
            <button
              type="submit"
              disabled={loading || (!useRecovery && code.length !== 6)}
              className="control-md w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
            >
              {loading ? 'Verifying...' : 'Verify and Continue'}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep('identity')
                  setOtpSent(false)
                  setOtp('')
                  setCode('')
                  setError('')
                }}
                className="text-foreground-muted hover:text-foreground"
              >
                ← Use a different account
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseRecovery(v => !v)
                  setCode('')
                  setError('')
                }}
                className="text-foreground-muted hover:text-foreground"
              >
                {useRecovery ? 'Use authenticator code' : 'Lost your device? Use a recovery code'}
              </button>
            </div>
          </form>
        )}

        {step === 'enroll' && enrollData && !recoveryCodes && (
          <div className="space-y-5">
            <div className="bg-surface-secondary border border-border-default rounded-lg p-4 text-sm text-foreground-secondary space-y-3">
              <p>
                Two-factor authentication is required for all admins. Open your authenticator app (Google Authenticator,
                1Password, Authy, etc.) and scan this QR code:
              </p>
              <div className="bg-white p-3 rounded-lg w-fit mx-auto">
                <img src={enrollData.qr_data_url} alt="Scan to add to your authenticator" className="w-48 h-48" />
              </div>
              <p className="text-xs text-foreground-muted">
                Can&apos;t scan? Enter this secret manually:{' '}
                <span className="font-mono text-foreground break-all">{enrollData.secret}</span>
              </p>
            </div>
            <form onSubmit={handleEnrollConfirm} className="space-y-4">
              <div>
                <label htmlFor="enroll_code" className="block text-sm font-medium text-foreground mb-1.5">
                  Enter the 6-digit code shown by your app
                </label>
                <input
                  type="text"
                  id="enroll_code"
                  name="enroll_code"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-colors tracking-widest text-center text-xl"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="control-md w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
              >
                {loading ? 'Confirming...' : 'Confirm and Finish Setup'}
              </button>
            </form>
          </div>
        )}

        {step === 'enroll' && recoveryCodes && (
          <div className="space-y-5">
            <div className="bg-surface-secondary border border-border-default rounded-lg p-4 text-sm text-foreground-secondary space-y-3">
              <p className="font-semibold text-foreground">Save these recovery codes now — they will not be shown again.</p>
              <p>
                Use any one of these codes if you lose access to your authenticator. Each code works only once. Store
                them in a password manager or print them.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-foreground text-sm bg-surface border border-border-default p-3 rounded">
                {recoveryCodes.map(c => (
                  <div key={c}>{c}</div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(recoveryCodes.join('\n'))}
                className="control-md w-full bg-surface-secondary hover:bg-surface text-foreground border border-border-default font-medium"
              >
                Copy all codes
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                go(callbackUrl, 'hard')
              }}
              className="control-md w-full bg-accent-500 hover:bg-accent-600 text-white font-semibold transition-colors"
            >
              I&apos;ve saved them — continue to dashboard
            </button>
          </div>
        )}

        <div className="mt-6 space-y-2">
          <div className="flex items-center gap-2 text-xs text-foreground-muted justify-center">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>Authorized Personnel Only</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground-muted justify-center">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>All access is logged and monitored</span>
          </div>
        </div>
    </AuthSplitShell>
  )
}
