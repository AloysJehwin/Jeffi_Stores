'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Toggle from '@/components/ui/Toggle'
import { OPEN_COOKIE_SETTINGS_EVENT, readConsent, saveConsent, type ConsentChoice } from '@/lib/client/consent'

export default function CookieConsentBanner() {
  const [open, setOpen] = useState(false)
  const [customise, setCustomise] = useState(false)
  const [choice, setChoice] = useState<ConsentChoice>({ analytics: false, ads: false })

  useEffect(() => {
    const stored = readConsent()
    if (stored) setChoice(stored)
    else setOpen(true)
    const reopen = () => {
      setChoice(readConsent() ?? { analytics: false, ads: false })
      setCustomise(true)
      setOpen(true)
    }
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen)
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen)
  }, [])

  if (!open) return null

  const decide = (c: ConsentChoice) => {
    saveConsent(c)
    setChoice(c)
    setOpen(false)
    setCustomise(false)
  }

  const btn = 'px-4 h-control text-sm font-medium rounded-lg transition-colors'
  const secondary = `${btn} border border-border-secondary text-foreground hover:bg-surface-secondary`

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl bg-surface-elevated border border-border-default rounded-2xl shadow-2xl p-4 sm:p-5">
        <h2 id="cookie-consent-title" className="text-base font-semibold text-foreground">
          Cookies on this store
        </h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          We use essential cookies to run the store. With your permission we also use analytics cookies to understand
          how the store is used and advertising cookies to personalise and measure ads. See our{' '}
          <Link href="/legal/privacy-policy" className="text-accent-600 hover:underline">
            privacy policy
          </Link>
          .
        </p>

        {customise && (
          <div className="mt-4 space-y-3 border-t border-border-default pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Essential</p>
                <p className="text-xs text-foreground-muted">Sign-in, cart and checkout. Always on.</p>
              </div>
              <Toggle checked onChange={() => {}} disabled size="sm" />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Analytics</p>
                <p className="text-xs text-foreground-muted">Visit and page statistics (Google Analytics).</p>
              </div>
              <Toggle
                checked={choice.analytics}
                onChange={v => setChoice(c => ({ ...c, analytics: v }))}
                size="sm"
                id="consent-analytics"
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Advertising</p>
                <p className="text-xs text-foreground-muted">Personalised ads (Google AdSense), ad measurement and remarketing (Google Ads).</p>
              </div>
              <Toggle
                checked={choice.ads}
                onChange={v => setChoice(c => ({ ...c, ads: v }))}
                size="sm"
                id="consent-ads"
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {customise ? (
            <button type="button" className={secondary} onClick={() => decide(choice)}>
              Save choices
            </button>
          ) : (
            <button type="button" className={secondary} onClick={() => setCustomise(true)}>
              Customise
            </button>
          )}
          <button type="button" className={secondary} onClick={() => decide({ analytics: false, ads: false })}>
            Reject non-essential
          </button>
          <button
            type="button"
            className={`${btn} bg-accent-600 text-white hover:bg-accent-700`}
            onClick={() => decide({ analytics: true, ads: true })}
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  )
}

/** Reopens the consent banner. Renders nothing on stores without a Google tag. */
export function CookieSettingsLink({ className }: { className?: string }) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    setEnabled(!!(window as unknown as { jeffiConsent?: boolean }).jeffiConsent)
  }, [])
  if (!enabled) return null
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))}
      className={className}
    >
      Cookie settings
    </button>
  )
}
