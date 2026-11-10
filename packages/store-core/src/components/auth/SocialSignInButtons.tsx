'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { SignInMethod, SocialPortal, SocialProvider } from '@/lib/auth/social/types'
import { SocialIcon } from './SocialIcons'

// The store's enabled sign-in methods (/api/auth/methods), fetched once per page load.
let cached: SignInMethod[] | null = null
let pending: Promise<SignInMethod[]> | null = null

function loadMethods(): Promise<SignInMethod[]> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = fetch('/api/auth/methods')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        cached = Array.isArray(data?.providers) ? (data.providers as SignInMethod[]) : []
        return cached
      })
      .catch(() => {
        pending = null
        return []
      })
  }
  return pending
}

export function useSignInMethods(): SignInMethod[] | null {
  const [methods, setMethods] = useState<SignInMethod[] | null>(cached)
  useEffect(() => {
    let active = true
    loadMethods().then(m => {
      if (active) setMethods(m)
    })
    return () => {
      active = false
    }
  }, [])
  return methods
}

export function socialStartUrl(provider: SocialProvider, portal: SocialPortal, redirect?: string): string {
  const qs = new URLSearchParams({ portal })
  if (redirect) qs.set('redirect', redirect)
  return `/api/auth/oauth/${provider}/start?${qs}`
}

const BUTTON =
  'flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border-secondary bg-surface hover:bg-surface-secondary transition-colors text-sm font-medium text-foreground disabled:opacity-60 disabled:cursor-not-allowed'

const Spinner = () => <div className="w-5 h-5 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />

/**
 * One button per sign-in method the store offers, then `children` (the "or" divider). Renders
 * nothing when the store offers none. `google_platform` hands back to the page's popup flow; the
 * rest leave for the provider and return through /api/auth/oauth/<provider>/callback.
 */
export default function SocialSignInButtons({
  portal,
  redirect,
  verb = 'Continue with',
  busyLabel = 'Signing in…',
  onGooglePlatform,
  googleBusy = false,
  className = 'mb-4',
  children,
}: {
  portal: SocialPortal
  /** Relative path to land on after sign-in. */
  redirect?: string
  verb?: string
  busyLabel?: string
  onGooglePlatform: () => void
  googleBusy?: boolean
  className?: string
  children?: ReactNode
}) {
  const methods = useSignInMethods()
  const [leavingFor, setLeavingFor] = useState<SocialProvider | null>(null)

  // Back from the provider restores this page from the back/forward cache with the spinner on.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeavingFor(null)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  if (methods === null) {
    // Same footprint as one button, so the form below does not jump when the list arrives.
    return (
      <>
        <div className={`h-[46px] rounded-lg border border-border-secondary bg-surface-secondary animate-pulse ${className}`} />
        {children}
      </>
    )
  }
  if (methods.length === 0) return null

  const anyBusy = googleBusy || leavingFor !== null
  const start = (m: SignInMethod) => {
    if (m.flow === 'google_platform') {
      onGooglePlatform()
      return
    }
    setLeavingFor(m.id)
    window.location.assign(socialStartUrl(m.id, portal, redirect))
  }
  const busy = (m: SignInMethod) => (m.flow === 'google_platform' ? googleBusy : leavingFor === m.id)

  // Up to two: full-width buttons. More: the first full width, the rest side by side.
  const [first, ...rest] = methods
  const stacked = methods.length <= 2
  const wide = (m: SignInMethod) => (
    <button key={m.id} type="button" onClick={() => start(m)} disabled={anyBusy} className={`w-full ${BUTTON}`}>
      {busy(m) ? <Spinner /> : <SocialIcon provider={m.id} />}
      {busy(m) ? busyLabel : `${verb} ${m.label}`}
    </button>
  )

  return (
    <>
      <div className={`space-y-3 ${className}`}>
        {stacked ? (
          methods.map(wide)
        ) : (
          <>
            {wide(first)}
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${rest.length}, minmax(0, 1fr))` }}>
              {rest.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => start(m)}
                  disabled={anyBusy}
                  aria-label={`${verb} ${m.label}`}
                  title={`${verb} ${m.label}`}
                  className={`${BUTTON} !gap-2 !px-2 min-w-0`}
                >
                  {busy(m) ? <Spinner /> : <SocialIcon provider={m.id} />}
                  <span className={rest.length >= 3 ? 'truncate hidden sm:inline' : 'truncate'}>{m.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {children}
    </>
  )
}
