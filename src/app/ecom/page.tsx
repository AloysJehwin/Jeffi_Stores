import Link from 'next/link'
import { listPlans } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

export default async function EcomLandingPage() {
  const plans = await listPlans()
  return (
    <div>
      {/* Hero */}
      <section className="px-4 py-20 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-foreground max-w-3xl mx-auto">
          Launch your own online store, <span className="text-accent-600 dark:text-accent-400">powered by Jeffi</span>
        </h1>
        <p className="text-foreground-muted mt-4 max-w-xl mx-auto">
          Your storefront, your admin panel, your subdomain — with payments, delivery and invoicing built in. Go live in minutes.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className="px-6 py-3 rounded-lg bg-accent-600 hover:bg-accent-700 text-white font-medium transition-colors">Get started</Link>
          <Link href="/signin" className="px-6 py-3 rounded-lg border border-border-default text-foreground hover:bg-surface-secondary transition-colors">Sign in</Link>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-4 py-16 bg-surface-elevated border-t border-border-default">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground text-center mb-2">Simple, transparent pricing</h2>
          <p className="text-foreground-muted text-center mb-10">Every plan includes the full storefront. Higher tiers unlock more admin features.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((p) => (
              <div key={p.slug} className="rounded-2xl border border-border-default bg-surface p-6 flex flex-col">
                <div className="font-semibold text-foreground">{p.name}</div>
                <div className="text-3xl font-bold text-foreground mt-2">₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}<span className="text-sm text-foreground-muted font-normal">/mo</span></div>
                <Link href="/signup" className="mt-6 text-center px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium transition-colors">Choose {p.name}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
