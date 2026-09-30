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
        <div className="inline-flex items-center rounded-xl border border-border-default bg-surface-secondary p-1 gap-1">
          <button
            type="button"
            onClick={() => setInterval('monthly')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${interval === 'monthly' ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'}`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval('yearly')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${interval === 'yearly' ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'}`}
          >
            Yearly
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
              20% off
            </span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
        {ordered.map(p => {
          const featured = p.slug === 'growth'
          const monthly = Number(p.monthly_price_inr)
          const price = interval === 'yearly' ? monthly * 12 : monthly
          const perMonth = interval === 'yearly' ? monthly : monthly

          return (
            <div
              key={p.slug}
              className={`relative rounded-2xl border p-6 flex flex-col ${featured ? 'border-accent-500 bg-surface-elevated shadow-xl lg:scale-[1.03]' : 'border-border-default bg-surface-elevated'}`}
            >
              {featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-accent-600 text-white text-xs font-semibold">
                  Most popular
                </span>
              )}
              <div className="text-xl font-bold">{p.name}</div>

              {/* Price display */}
              <div className="mt-2">
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-extrabold">₹{price.toLocaleString('en-IN')}</span>
                  <span className="text-sm text-foreground-muted font-normal mb-1">
                    /{interval === 'yearly' ? 'yr' : 'mo'}
                  </span>
                </div>
                {interval === 'yearly' && (
                  <div className="text-xs text-green-600 dark:text-green-400 font-medium mt-0.5">
                    20% off applied at checkout
                  </div>
                )}
              </div>

              <p className="text-sm text-foreground-secondary mt-3 flex-1">{PLAN_BLURB[p.slug]}</p>

              <Link
                href={`/signup?plan=${p.slug}&interval=${interval}`}
                className={`mt-6 text-center px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${featured ? 'bg-accent-600 hover:bg-accent-700 text-white' : 'border border-border-default hover:bg-surface-secondary'}`}
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
