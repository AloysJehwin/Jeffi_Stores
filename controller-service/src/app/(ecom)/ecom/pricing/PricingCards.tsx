'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Segmented } from '../_ui'

type Interval = 'monthly' | 'yearly'
interface Plan {
  slug: string
  name: string
  tier: number
}

const gstLabel = (rate = 0.18) => `${Math.round(rate * 100)}% GST`

const PLAN_BLURB: Record<string, string> = {
  basic: 'Everything to launch — full storefront + core admin.',
  growth: 'Quotations, CRM, returns, coupons, inventory.',
  pro: 'Marketing, AI assistant, B2B portal, channel sync.',
  enterprise: 'Large servers from the start and priority support.',
}

/**
 * Plans are a single subscription — servers and plan features in one price. `fromInr` is each plan's
 * floor price before GST at its minimum preset (none when prices can't be computed); the owner picks the size on sign-up.
 */
export default function PricingCards({ plans, fromInr, gstRate }: { plans: Plan[]; fromInr?: Record<string, number> | null; gstRate?: number }) {
  const [interval, setInterval] = useState<Interval>('monthly')
  const ordered = [...plans].sort((a, b) => a.tier - b.tier)

  return (
    <>
      {/* Interval toggle */}
      <div className="flex justify-center mb-8 sm:mb-10">
        <Segmented<Interval> ariaLabel="Billing interval" value={interval} onChange={setInterval}
          options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly', count: <span className="px-2 py-0.5 rounded-full text-[10px] font-bold org-sage org-sage-text">Save 2 months</span> }]} />
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-5 w-full">
        {ordered.map(p => {
          const featured = p.slug === 'growth'
          const floor = fromInr?.[p.slug]
          const price = floor == null ? null : interval === 'yearly' ? floor * 10 : floor

          return (
            <div
              key={p.slug}
              className={`relative min-w-0 rounded-3xl sm:rounded-[2rem] p-6 sm:p-7 flex flex-col ${featured ? 'org-peach' : 'org-sand'}`}
            >
              {featured && (
                <span className="ecom-accent-bg absolute -top-3 left-6 sm:left-7 px-3 py-1 rounded-full text-white text-xs font-bold">
                  Most popular
                </span>
              )}
              <div className="font-display font-black text-2xl">{p.name}</div>

              {/* Price display */}
              <div className="mt-2">
                {price == null ? (
                  <div className="font-display font-black text-2xl mt-3">Sized at sign-up</div>
                ) : (
                  <div className="flex flex-wrap items-end gap-x-1">
                    <span className="text-xs text-foreground-muted mb-2">from</span>
                    <span className="font-display font-black text-4xl">₹{Math.round(price).toLocaleString('en-IN')}</span>
                    <span className="text-sm text-foreground-muted font-normal mb-1">
                      /{interval === 'yearly' ? 'yr' : 'mo'} + GST
                    </span>
                  </div>
                )}
                {interval === 'yearly' && (
                  <div className="text-xs org-sage-text font-semibold mt-0.5">
                    12 months for the price of 10
                  </div>
                )}
                <div className="text-xs text-foreground-secondary mt-1">
                  Plan &amp; servers in one subscription · {gstLabel(gstRate)} added at checkout
                </div>
              </div>

              <p className="text-sm text-foreground-secondary mt-3 flex-1">{PLAN_BLURB[p.slug]}</p>

              <Link
                href={`/signup?plan=${p.slug}&interval=${interval}`}
                className={`mt-6 text-center px-4 py-3 sm:py-2.5 rounded-full text-sm font-display font-bold transition-colors ${featured ? 'ecom-accent-bg text-white' : 'bg-surface-elevated text-foreground hover:bg-surface'}`}
              >
                Choose {p.name}
              </Link>
            </div>
          )
        })}
      </div>

      {/* Yearly savings callout */}
      {interval === 'yearly' && (
        <p className="text-center text-sm text-foreground-muted mt-6">
          Billed annually. Switch to monthly anytime from your billing dashboard.
        </p>
      )}
    </>
  )
}
