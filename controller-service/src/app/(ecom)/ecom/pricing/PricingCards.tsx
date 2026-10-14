'use client'

import Link from 'next/link'
import { useState } from 'react'

type Interval = 'monthly' | 'yearly'
interface Plan {
  slug: string
  name: string
  tier: number
  monthly_price_inr: string
}

const PLAN_BLURB: Record<string, string> = {
  basic: 'Everything to launch — full storefront + core admin.',
  growth: 'Quotations, CRM, returns, coupons, inventory.',
  pro: 'Marketing, AI assistant, B2B portal, channel sync.',
  enterprise: 'Dedicated infra, custom domain, priority support.',
}

export default function PricingCards({ plans }: { plans: Plan[] }) {
  const [interval, setInterval] = useState<Interval>('monthly')
  const ordered = [...plans].sort((a, b) => a.tier - b.tier)

  return (
    <>
      {/* Interval toggle */}
      <div className="flex justify-center mb-10">
        <div className="inline-flex items-center rounded-full org-sand p-1 gap-1">
          <button
            type="button"
            onClick={() => setInterval('monthly')}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${interval === 'monthly' ? 'ecom-accent-bg text-white' : 'text-foreground-secondary hover:text-foreground'}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval('yearly')}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-2 ${interval === 'yearly' ? 'ecom-accent-bg text-white' : 'text-foreground-secondary hover:text-foreground'}`}
          >
            Yearly
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold org-sage org-sage-text">
              2 months free
            </span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
        {ordered.map(p => {
          const featured = p.slug === 'growth'
          const monthly = Number(p.monthly_price_inr)
          const price = interval === 'yearly' ? monthly * 10 : monthly
          const perMonth = interval === 'yearly' ? monthly : monthly

          return (
            <div
              key={p.slug}
              className={`relative rounded-[2rem] p-7 flex flex-col ${featured ? 'org-peach' : 'org-sand'}`}
            >
              {featured && (
                <span className="ecom-accent-bg absolute -top-3 left-7 px-3 py-1 rounded-full text-white text-xs font-bold">
                  Most popular
                </span>
              )}
              <div className="font-display font-black text-2xl">{p.name}</div>

              {/* Price display */}
              <div className="mt-2">
                <div className="flex items-end gap-1">
                  <span className="font-display font-black text-4xl">₹{price.toLocaleString('en-IN')}</span>
                  <span className="text-sm text-foreground-muted font-normal mb-1">
                    /{interval === 'yearly' ? 'yr' : 'mo'}
                  </span>
                </div>
                {interval === 'yearly' && (
                  <div className="text-xs org-sage-text font-semibold mt-0.5">
                    2 months free
                  </div>
                )}
              </div>

              <p className="text-sm text-foreground-secondary mt-3 flex-1">{PLAN_BLURB[p.slug]}</p>

              <Link
                href={`/signup?plan=${p.slug}&interval=${interval}`}
                className={`mt-6 text-center px-4 py-2.5 rounded-full text-sm font-display font-bold transition-colors ${featured ? 'ecom-accent-bg text-white' : 'bg-surface-elevated text-foreground hover:bg-surface'}`}
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
