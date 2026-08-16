import Link from 'next/link'
import { listPlans } from '@/lib/tenant-registry'
import { BrowserFrame } from './BrowserFrame'

export const dynamic = 'force-dynamic'

const PLAN_BLURB: Record<string, string> = {
  basic: 'Everything to launch — full storefront + core admin.',
  growth: 'Quotations, CRM, returns, coupons, inventory.',
  pro: 'Marketing, AI assistant, B2B portal, channel sync.',
  enterprise: 'Dedicated infra, custom domain, priority support.',
}

const FEATURES = [
  { title: 'Your own storefront', body: 'A fast, modern shop on your subdomain — product catalogue, cart, checkout, wishlist. Yours to brand.', icon: 'store' },
  { title: 'Payments, split for you', body: 'Collect online + COD. Money is split and settled to your account automatically, minus fees.', icon: 'card' },
  { title: 'Delivery built in', body: 'Delhivery pickups from your warehouse, live tracking, and automatic charge reconciliation.', icon: 'truck' },
  { title: 'GST invoicing', body: 'Compliant GST invoices on every order, quotations, and cash sales — generated for you.', icon: 'doc' },
  { title: 'One admin panel', body: 'Products, orders, customers, inventory, marketing — run the whole store from one place.', icon: 'grid' },
  { title: 'Live in minutes', body: 'Pick a plan, name your store, verify your bank — we provision the rest. No servers to manage.', icon: 'bolt' },
]

const STEPS = [
  { n: '01', t: 'Create your account', d: 'Sign up with email or Google — no passwords.' },
  { n: '02', t: 'Name your store', d: 'Choose a plan and claim your subdomain.' },
  { n: '03', t: 'Verify your bank', d: 'A ₹1 penny-drop confirms where your money lands.' },
  { n: '04', t: 'Go live', d: 'We provision your store. Start selling the same day.' },
]

function FeatureIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    store: 'M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z',
    card: 'M2.25 8.25h19.5M2.25 9v9a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75V9zm4.5 6.75h3',
    truck: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-9m0 0V6.375c0-.621.504-1.125 1.125-1.125h9.75c.621 0 1.125.504 1.125 1.125v3.75',
    doc: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
    grid: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
    bolt: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  }
  return (
    <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-accent-500/10 text-accent-600 dark:text-accent-400">
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={paths[name]} /></svg>
    </span>
  )
}

export default async function EcomLandingPage() {
  const plans = await listPlans()

  return (
    <div className="text-foreground">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* gradient-mesh + grid backdrop */}
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_-10%,rgba(16,185,129,0.18),transparent),radial-gradient(50%_40%_at_0%_10%,rgba(234,179,8,0.10),transparent)]" />
          <div className="absolute inset-0 opacity-[0.04] bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] bg-[size:44px_44px]" />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-20 pb-16 sm:pt-28 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-elevated/70 backdrop-blur px-3 py-1 text-xs font-medium text-foreground-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" /> Now onboarding new stores
          </span>
          <h1 className="font-bebas tracking-tight leading-[0.92] mt-6 text-6xl sm:text-8xl">
            SELL ANYTHING.<br />
            <span className="text-accent-600 dark:text-accent-400">WE RUN THE STORE.</span>
          </h1>
          <p className="mt-6 text-lg text-foreground-secondary max-w-2xl mx-auto">
            Launch a complete online store on your own subdomain — storefront, admin panel, payments,
            delivery and GST invoicing, all managed for you. No servers. No code. Live today.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link href="/signup" className="px-7 py-3.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white font-semibold transition-colors shadow-lg shadow-accent-600/20">
              Start your store — free to set up
            </Link>
            <Link href="#pricing" className="px-7 py-3.5 rounded-lg border border-border-default bg-surface-elevated hover:bg-surface-secondary font-semibold transition-colors">
              See pricing
            </Link>
          </div>

          {/* Hero product shot */}
          <div className="mt-16 max-w-5xl mx-auto">
            <BrowserFrame src="/images/ecom-landing/storefront.png" alt="Your storefront" caption="yourstore.jeffistores.in" />
          </div>
        </div>
      </section>

      {/* ── Trust bar ── */}
      <section className="border-y border-border-default bg-surface-elevated">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[['Storefront + Admin', 'in one platform'], ['Online + COD', 'payments built in'], ['Delhivery', 'delivery & tracking'], ['GST-ready', 'compliant invoicing']].map(([a, b]) => (
            <div key={a}>
              <div className="font-bebas text-2xl tracking-wide text-foreground">{a}</div>
              <div className="text-xs text-foreground-muted mt-0.5">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Showcase ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-accent-600 dark:text-accent-400 font-semibold text-sm uppercase tracking-widest">Run everything from one panel</p>
            <h2 className="font-bebas text-5xl mt-3 leading-none">A DASHBOARD THAT MEANS BUSINESS</h2>
            <p className="text-foreground-secondary mt-4">
              Revenue, orders, low-stock alerts and daily tasks at a glance. Drill into any order,
              manage your catalogue, and keep the shelves full — without spreadsheets.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-foreground-secondary">
              {['Real-time revenue & order metrics', 'Inventory + purchase orders', 'Customer CRM & tasks'].map((f) => (
                <li key={f} className="flex items-center gap-2"><span className="text-accent-600 dark:text-accent-400">✓</span>{f}</li>
              ))}
            </ul>
          </div>
          <BrowserFrame src="/images/ecom-landing/admin-dashboard.png" alt="Your admin dashboard" caption="admin-yourstore.jeffistores.in/dashboard" />
        </div>

        <div className="grid lg:grid-cols-2 gap-10 items-center mt-20">
          <div className="lg:order-2">
            <p className="text-accent-600 dark:text-accent-400 font-semibold text-sm uppercase tracking-widest">Catalogue & orders</p>
            <h2 className="font-bebas text-5xl mt-3 leading-none">FROM PRODUCT TO DOORSTEP</h2>
            <p className="text-foreground-secondary mt-4">
              List products with variants and images, take orders online or COD, print packing slips
              and labels, and hand off to Delhivery — the whole fulfilment flow, handled.
            </p>
          </div>
          <div className="lg:order-1 grid gap-6">
            <BrowserFrame src="/images/ecom-landing/admin-products.png" alt="Product management" caption="admin · products" />
            <BrowserFrame src="/images/ecom-landing/admin-orders.png" alt="Orders" caption="admin · orders" className="translate-x-0 lg:translate-x-8" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="bg-surface-elevated border-y border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className="font-bebas text-5xl text-center leading-none">EVERYTHING INCLUDED</h2>
          <p className="text-center text-foreground-secondary mt-3 max-w-xl mx-auto">Even the Basic plan ships with the full storefront. Higher tiers just unlock more admin power.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-border-default bg-surface p-6 hover:shadow-lg transition-shadow">
                <FeatureIcon name={f.icon} />
                <h3 className="font-semibold text-lg mt-4">{f.title}</h3>
                <p className="text-sm text-foreground-secondary mt-1.5">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <h2 className="font-bebas text-5xl text-center leading-none">LIVE IN FOUR STEPS</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
          {STEPS.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-border-default bg-surface-elevated p-6">
              <span className="font-bebas text-5xl text-accent-500/25 leading-none">{s.n}</span>
              <h3 className="font-semibold mt-2">{s.t}</h3>
              <p className="text-sm text-foreground-secondary mt-1">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="bg-surface-elevated border-y border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
          <h2 className="font-bebas text-5xl text-center leading-none">PRICING THAT SCALES WITH YOU</h2>
          <p className="text-center text-foreground-secondary mt-3">Transparent monthly pricing. Cancel anytime.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12">
            {plans.map((p, i) => {
              const featured = p.slug === 'growth'
              return (
                <div key={p.slug} className={`relative rounded-2xl border p-6 flex flex-col ${featured ? 'border-accent-500 bg-surface shadow-xl scale-[1.02]' : 'border-border-default bg-surface'}`}>
                  {featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-accent-600 text-white text-xs font-semibold">Most popular</span>}
                  <div className="font-bebas text-2xl tracking-wide">{p.name}</div>
                  <div className="text-3xl font-bold mt-1">₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}<span className="text-sm text-foreground-muted font-normal">/mo</span></div>
                  <p className="text-sm text-foreground-secondary mt-3 min-h-[2.5rem]">{PLAN_BLURB[p.slug]}</p>
                  <Link href="/signup" className={`mt-6 text-center px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${featured ? 'bg-accent-600 hover:bg-accent-700 text-white' : 'border border-border-default hover:bg-surface-secondary'}`}>
                    Choose {p.name}
                  </Link>
                </div>
              )
            })}
          </div>
          <p className="text-center text-xs text-foreground-muted mt-6">Custom domain available as an add-on · Daily payouts optional (+5%)</p>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_120%,rgba(16,185,129,0.20),transparent)]" />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-24 text-center">
          <h2 className="font-bebas text-6xl leading-none">YOUR STORE IS ONE STEP AWAY</h2>
          <p className="text-foreground-secondary mt-4">Set it up in minutes. Start selling today.</p>
          <Link href="/signup" className="inline-block mt-8 px-8 py-4 rounded-lg bg-accent-600 hover:bg-accent-700 text-white font-semibold text-lg transition-colors shadow-lg shadow-accent-600/20">
            Get started free
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border-default bg-surface-elevated">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-foreground-muted">
          <div className="flex items-center gap-2 font-bold text-foreground">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white text-sm">J</span>
            Jeffi Commerce
          </div>
          <div className="flex gap-6">
            <Link href="#pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/signin" className="hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground">Get started</Link>
          </div>
          <div>© 2026 Jeffi Stores</div>
        </div>
      </footer>
    </div>
  )
}
