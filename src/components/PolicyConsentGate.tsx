'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

export default function PolicyConsentGate() {
  const { user, refreshUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)

  const open = !!user && user.requiresPolicyAcceptance === true

  useEffect(() => {
    if (open) {
      setAccepted(false)
      setError('')
    }
  }, [open])

  if (!open || !user) return null

  const isLegacy = user.policiesAcceptedVersion != null
  const portal = user.isBusiness ? 'business' : 'customer'

  async function submit() {
    if (!accepted || !user) return
    setSubmitting(true)
    setError('')
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (user.isBusiness) {
        ;(headers as Record<string, string>)['X-Auth-Portal'] = 'business'
      }
      const res = await fetch('/api/user/accept-policies', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ version: user.policyVersion }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to record acceptance.')
        return
      }
      await refreshUser()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface-elevated rounded-2xl shadow-2xl w-full max-w-md p-6 border border-border-default">
        <h2 className="text-lg font-bold text-foreground mb-1">
          {isLegacy ? 'Our policies have been updated' : 'Please review our policies'}
        </h2>
        <p className="text-sm text-foreground-secondary mb-4">
          {isLegacy
            ? 'We\'ve refreshed our Privacy Policy and Terms & Conditions. Please review and accept to continue using your account.'
            : 'Before continuing, please review our Privacy Policy and Terms & Conditions.'}
        </p>

        <div className="bg-surface rounded-lg border border-border-default p-3 mb-4 text-xs text-foreground-secondary space-y-2">
          <p><span className="font-semibold text-foreground">What we collect:</span> account, order, and support details — plus aggregated browsing analytics. Full details in the Privacy Policy.</p>
          <p><span className="font-semibold text-foreground">Why:</span> to run your account, fulfil orders, file GST, and keep the platform secure.</p>
          <p><span className="font-semibold text-foreground">Sharing:</span> only with payments/shipping/hosting partners and as required by law. We never sell your data.</p>
        </div>

        <label className="flex items-start gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={accepted}
            onChange={e => setAccepted(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-accent-500 cursor-pointer"
          />
          <span className="text-sm text-foreground select-none">
            I have read and agree to the{' '}
            <Link href="/legal/privacy-policy" target="_blank" className="text-accent-500 hover:underline font-medium">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link href="/legal/terms-and-conditions" target="_blank" className="text-accent-500 hover:underline font-medium">
              Terms &amp; Conditions
            </Link>
            .
          </span>
        </label>

        {error && (
          <p className="text-xs text-red-500 mb-3">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={!accepted || submitting}
          className="w-full px-4 py-2.5 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {submitting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {submitting ? 'Recording...' : 'Accept and continue'}
        </button>

        <p className="text-[10px] text-foreground-muted mt-3 text-center">
          {portal === 'business' ? 'Business portal' : 'Customer storefront'} · Acceptance required to continue.
        </p>
      </div>
    </div>
  )
}
