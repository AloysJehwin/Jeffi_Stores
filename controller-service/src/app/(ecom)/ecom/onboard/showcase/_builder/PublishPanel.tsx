'use client'

import { useState } from 'react'
import { ExternalLink, Loader2, Rocket } from 'lucide-react'
import { noteCls, primaryBtn } from '../../ui'
import { SHOWCASE_FREE_DAYS, SHOWCASE_HOST_PREFIX, SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import type { ClientSite } from '@controller/lib/showcase-builder/site'

// Publishing: a draft goes live (its first month free), a live site takes the studio's design changes. Details and
// content are live as soon as they are saved; the design waits for this.

export interface Published {
  site: ClientSite
  url: string
  first: boolean
}

export default function PublishPanel({
  site,
  ready,
  blocker,
  onPublished,
  siteUrl,
  billingHref,
}: {
  site: ClientSite | null
  /** The studio has a page to publish (or the site already has one). */
  ready: boolean
  /** Why it can't be published yet (the details step's problem), or null. */
  blocker: string | null
  onPublished: (p: Published) => void
  /** Where the site opens (lib/showcase/host showcaseUrl). */
  siteUrl?: string | null
  /** Where hosting is paid: the site's page by default. */
  billingHref?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; code?: string; topUpUrl?: string } | null>(null)
  const live = site?.status === 'live'
  const paused = site?.status === 'paused'

  async function publish() {
    if (!site) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ecom/onboard/showcase/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteId: site.id }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setError({ message: data.error || 'Your site could not be published. Try again.', code: data.code, topUpUrl: typeof data.topUpUrl === 'string' ? data.topUpUrl : undefined })
      onPublished({ site: data.site, url: data.url, first: !!data.first })
    } catch {
      setError({ message: 'Your site could not be published: check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  const host = site ? `${SHOWCASE_HOST_PREFIX}${site.slug}.jeffistores.in` : null
  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="org-sage inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <Rocket className="h-6 w-6 org-sage-text" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-black text-foreground">{live ? 'Publish your changes' : paused ? 'Your site is paused' : 'Put your site live'}</h3>
          <p className="mt-0.5 text-sm text-foreground-secondary">
            {live ? (
              <>
                Changes to your details and content are already live. Design changes from the studio go live when you publish them.
              </>
            ) : paused ? (
              <>Publishing brings it back while its hosting is paid.</>
            ) : (
              <>
                At <span className="font-mono text-foreground">{host ?? 'your address'}</span>. The first {SHOWCASE_FREE_DAYS} days are free, then ₹{SHOWCASE_PRICE_INR} a month from your wallet.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <button type="button" onClick={publish} disabled={busy || !site || !ready || !!blocker} className={`${primaryBtn} max-sm:w-full`} title={blocker ?? (ready ? undefined : 'Design your page first')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {live ? 'Publish changes' : paused ? 'Publish again' : 'Publish my site'}
          </button>
          {(live || paused) && host && (
            <a href={siteUrl ?? `https://${host}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-foreground-secondary hover:text-foreground">
              {host} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      {(blocker || !ready) && !error && <p className="mt-3 text-xs text-foreground-muted">{blocker ?? 'Design your page first: it appears in the studio above.'}</p>}
      {error && (
        <p role="alert" className={`${noteCls} mt-4 bg-[#f2d4cd] text-[#8a2e1f]`}>
          {error.message}
          {(error.code === 'payment_due' || error.topUpUrl) && (
            <>
              {' '}
              <a href={error.topUpUrl ?? billingHref ?? (site ? `/dashboard/showcase/${site.id}` : '/dashboard/showcase')} className="font-semibold underline">
                {error.topUpUrl ? 'Add money to your wallet' : 'Pay for hosting'}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  )
}
