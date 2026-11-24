'use client'

import Link from 'next/link'
import { ArrowRight, Check, Loader2, Store } from 'lucide-react'
import type { ShowcaseConsoleState, StorePlanOffer } from '@controller/lib/showcase/state'
import { fmtDay, hostingView } from '@controller/lib/showcase/hosting'
import { showcaseMonthly } from '@/lib/showcase/offer'

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

/** A store plan picked here opens the store application on it (onboard/page.tsx pickedPlan). */
export const storeOnboardHref = (planSlug: string) => `/onboard?mode=add-store&plan=${encodeURIComponent(planSlug)}`

/**
 * A site whose trial ended, whose hosting lapsed or whose subscription halted: keep it as a Showcase, or move up to an
 * online store. `plans` is null once the owner has a store (then only Keep shows).
 */
export default function KeepOnline({
  site,
  plans,
  tenantSlug,
  onKeep,
  busy,
}: {
  site: ShowcaseConsoleState
  plans: StorePlanOffer[] | null
  tenantSlug: string
  /** Puts the site on the subscription (the hosting route's resume/autopay); a halted subscription is paid on Billing instead. */
  onKeep: () => void
  busy: boolean
}) {
  const view = hostingView(site)
  const halted = view.kind === 'halted'
  const offline = site.status === 'paused'
  const title = halted ? 'Your last payment didn’t go through' : site.lineStatus === 'trial' ? 'Your free trial has ended' : 'Hosting for this site has lapsed'
  const lead = halted
    ? `Pay to keep ${site.host} online${site.graceUntil ? `: it goes offline on ${fmtDay(site.graceUntil)}` : ''}.`
    : offline
      ? `${site.host} is offline. Your page and enquiries are kept.`
      : `${site.host} goes offline soon unless it is paid.`
  const billingHref = `/dashboard/billing?tenant=${encodeURIComponent(tenantSlug)}`

  return (
    <section aria-labelledby="keep-online-title" className="rounded-2xl border border-border-default bg-surface-elevated p-5 sm:p-6">
      <h2 id="keep-online-title" className="font-display text-xl font-black text-foreground">
        {title}
      </h2>
      <p className="mt-1 text-sm text-foreground-secondary">{lead} Choose how to carry on.</p>

      <div className={`mt-5 grid gap-4 ${plans?.length ? 'md:grid-cols-2' : ''}`}>
        <div className="flex flex-col rounded-xl border border-border-default p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">Keep Showcase</h3>
          <p className="mt-1 font-display text-2xl font-black text-foreground">{showcaseMonthly(site.priceInr)}</p>
          <ul className="mt-3 flex-1 space-y-2 text-sm text-foreground-secondary">
            {['Your page, address and enquiries stay as they are', 'Charged on your subscription with autopay', 'Stop any time from this page'].map(p => (
              <li key={p} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
          {halted ? (
            <Link href={billingHref} className={`${btn} ecom-accent-bg mt-4 text-white`}>
              Pay on Billing
            </Link>
          ) : (
            <button type="button" onClick={onKeep} disabled={busy} className={`${btn} ecom-accent-bg mt-4 text-white`}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Keep Showcase · {showcaseMonthly(site.priceInr)}
            </button>
          )}
        </div>

        {!!plans?.length && (
          <div className="flex flex-col rounded-xl border border-border-default p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Store className="h-4 w-4 text-foreground-muted" aria-hidden /> Upgrade to an online store
            </h3>
            <p className="mt-1 text-sm text-foreground-secondary">Sell online with your own store. Every store plan includes one Showcase site.</p>
            <ul className="mt-3 space-y-2">
              {plans.map(p => (
                <li key={p.slug}>
                  <Link
                    href={storeOnboardHref(p.slug)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-default px-3.5 py-2.5 text-sm transition-colors hover:bg-surface-secondary"
                  >
                    <span className="min-w-0 font-semibold text-foreground">{p.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-foreground-secondary">
                      {inr(p.priceInr)}/month <ArrowRight className="h-4 w-4" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
