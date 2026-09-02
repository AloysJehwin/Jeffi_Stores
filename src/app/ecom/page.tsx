import Link from 'next/link'
import { listPlans } from '@/lib/tenant-registry'
import { BrowserFrame } from './BrowserFrame'
import { PhoneMock, Gear, Coin, TrendUp, Dots } from './Shapes'

export const dynamic = 'force-dynamic'

const PLAN_BLURB: Record<string, string> = {
  basic: 'Everything to launch — full storefront + core admin.',
  growth: 'Quotations, CRM, returns, coupons, inventory.',
  pro: 'Marketing, AI assistant, B2B portal, channel sync.',
  enterprise: 'Dedicated infra, custom domain, priority support.',
}

// Visual-first feature blocks — one big screenshot each, minimal copy (Stripe/Shopify rhythm).
const SHOWCASES: { eyebrow: string; title: string; caption: string; alt: string; side: 'left' | 'right' }[] = [
  { eyebrow: 'Your storefront', title: 'A shop your customers love', caption: 'yourstore.jeffistores.in', alt: 'Storefront', side: 'right' },
  { eyebrow: 'One admin panel', title: 'Run everything from here', caption: 'admin · dashboard', alt: 'Admin dashboard', side: 'left' },
  { eyebrow: 'Catalogue', title: 'Products, variants, images', caption: 'admin · products', alt: 'Product management', side: 'right' },
  { eyebrow: 'Orders & fulfilment', title: 'From cart to doorstep', caption: 'admin · orders', alt: 'Orders', side: 'left' },
  { eyebrow: 'Delivery', title: 'Delhivery pickups & tracking', caption: 'admin · shipment tracking', alt: 'Shipment tracking', side: 'right' },
  { eyebrow: 'GST & invoicing', title: 'Compliant invoices, automatic', caption: 'admin · invoices', alt: 'GST invoice', side: 'left' },
]

export default async function EcomLandingPage() {
  const plans = await listPlans()

  return (
    <div className="text-foreground">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_-10%,rgba(16,185,129,0.18),transparent),radial-gradient(50%_40%_at_0%_10%,rgba(234,179,8,0.10),transparent)]" />
          <div className="absolute inset-0 opacity-[0.04] bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] bg-[size:44px_44px]" />
        </div>
        <div className="w-full px-6 lg:px-12 pt-20 pb-14 sm:pt-28 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-elevated/70 backdrop-blur px-3 py-1 text-xs font-medium text-foreground-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" /> Now onboarding new stores
          </span>
          <h1 className="mt-6 text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]">
            Sell anything.<br /><span className="text-accent-600 dark:text-accent-400">We run the store.</span>
          </h1>
          <p className="mt-6 text-lg text-foreground-secondary max-w-2xl mx-auto">
            A complete online store on your own subdomain — storefront, admin, payments, delivery and GST, managed for you.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signup" className="w-full sm:w-auto px-7 py-3.5 rounded-lg bg-accent-600 hover:bg-accent-700 text-white font-semibold transition-colors shadow-lg shadow-accent-600/20">Start your store</Link>
            <Link href="/pricing" className="w-full sm:w-auto px-7 py-3.5 rounded-lg border border-border-default bg-surface-elevated hover:bg-surface-secondary font-semibold transition-colors">See pricing</Link>
          </div>
          {/* big hero screenshot */}
          <div className="mt-16 w-full"><BrowserFrame alt="Your storefront" caption="yourstore.jeffistores.in" /></div>
        </div>
      </section>

      {/* ── Trust bar ── */}
      <section className="border-y border-border-default bg-surface-elevated">
        <div className="w-full px-6 lg:px-12 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[['Storefront + Admin', 'one platform'], ['Online + COD', 'payments built in'], ['Delhivery', 'delivery & tracking'], ['GST-ready', 'invoicing']].map(([a, b]) => (
            <div key={a}><div className="text-lg sm:text-xl font-bold">{a}</div><div className="text-xs text-foreground-muted mt-0.5">{b}</div></div>
          ))}
        </div>
      </section>

      {/* ── Screenshot gallery: alternating visual blocks, minimal copy ── */}
      <section className="w-full px-6 lg:px-12 py-16 space-y-20 lg:space-y-28">
        {SHOWCASES.map((s) => (
          <div key={s.title} className="grid lg:grid-cols-5 gap-8 items-center">
            <div className={`lg:col-span-2 ${s.side === 'left' ? 'lg:order-2' : ''}`}>
              <p className="text-accent-600 dark:text-accent-400 font-semibold text-sm uppercase tracking-widest">{s.eyebrow}</p>
              <h2 className="text-3xl lg:text-4xl font-extrabold mt-2 leading-tight">{s.title}</h2>
            </div>
            <div className={`lg:col-span-3 ${s.side === 'left' ? 'lg:order-1' : ''}`}>
              <BrowserFrame alt={s.alt} caption={s.caption} />
            </div>
          </div>
        ))}
      </section>

      {/* ── Bento: device mockups + decorative shapes ── */}
      <section className="relative w-full px-6 lg:px-12 py-20 bg-surface-elevated border-y border-border-default overflow-hidden">
        {/* decorative background shapes (no emojis — inline SVG) */}
        <Gear className="hidden md:block absolute -left-6 top-16 w-24 h-24 text-accent-500/10" />
        <Gear className="hidden md:block absolute left-24 top-40 w-14 h-14 text-accent-500/10" />
        <Coin className="hidden md:block absolute right-16 top-24 w-16 h-16 text-primary-500/15" />
        <TrendUp className="hidden md:block absolute right-1/3 bottom-10 w-20 h-20 text-accent-500/10" />
        <Dots className="hidden md:block absolute right-8 bottom-16 w-28 h-28 text-foreground/10" />

        <div className="relative w-full text-center mb-12">
          <p className="text-accent-600 dark:text-accent-400 font-semibold text-sm uppercase tracking-widest">Built for mobile commerce</p>
          <h2 className="text-4xl lg:text-5xl font-extrabold mt-3">Your store, in every pocket</h2>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5 w-full items-stretch">
          {/* large: phone storefront */}
          <div className="md:col-span-2 rounded-3xl border border-border-default bg-surface p-8 flex flex-col sm:flex-row items-center gap-8">
            <PhoneMock variant="store" />
            <div className="max-w-xs">
              <h3 className="text-2xl font-bold">A storefront that sells itself</h3>
              <p className="text-foreground-secondary mt-2">Fast, mobile-first shopping — catalogue, search, cart and checkout tuned for conversion on any device.</p>
            </div>
          </div>
          {/* accent ₹0 tile with coin shape */}
          <div className="relative rounded-3xl bg-gradient-to-br from-accent-600 to-primary-600 text-white p-6 flex flex-col justify-between overflow-hidden">
            <Coin className="absolute -right-4 -bottom-4 w-28 h-28 text-white/15" />
            <div className="relative text-5xl font-extrabold leading-none">₹0</div>
            <p className="relative text-sm text-white/90">setup cost · go live today</p>
          </div>
          {/* payments phone */}
          <div className="rounded-3xl border border-border-default bg-surface p-8 flex flex-col items-center text-center">
            <PhoneMock variant="card" className="w-[150px]" />
            <h3 className="text-lg font-bold mt-5">Payments, settled for you</h3>
            <p className="text-sm text-foreground-secondary mt-1">Online & COD split automatically.</p>
          </div>
          {/* analytics phone */}
          <div className="md:col-span-2 rounded-3xl border border-border-default bg-surface p-8 flex flex-col sm:flex-row-reverse items-center gap-8">
            <PhoneMock variant="chart" />
            <div className="max-w-xs">
              <h3 className="text-2xl font-bold">Insights on the go</h3>
              <p className="text-foreground-secondary mt-2">Revenue, orders and stock at a glance — manage the whole business from your phone.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrations strip ── */}
      <section className="w-full px-6 lg:px-12 py-12">
        <p className="text-center text-sm text-foreground-muted uppercase tracking-widest mb-8">Powered by the tools you trust</p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 w-full">
          {['Razorpay', 'Delhivery', 'GST / GSTN', 'Google', 'AWS'].map((n) => <span key={n} className="text-xl font-bold text-foreground-muted/70">{n}</span>)}
        </div>
      </section>

      {/* ── Metrics band ── */}
      <section className="w-full px-6 lg:px-12 py-16 bg-gradient-to-br from-accent-600 to-primary-600 text-white">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 w-full text-center">
          {[['Minutes', 'to go live'], ['100%', 'storefront on every plan'], ['Online + COD', 'payments handled'], ['GST-ready', 'invoicing']].map(([a, b]) => (
            <div key={a}><div className="text-4xl lg:text-5xl font-extrabold">{a}</div><div className="text-white/80 text-sm mt-2">{b}</div></div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="w-full px-6 lg:px-12 py-20">
        <div className="text-center"><h2 className="text-4xl lg:text-5xl font-extrabold">Pricing that scales with you</h2><p className="text-foreground-secondary mt-3 text-lg">Every plan ships the full storefront. Cancel anytime.</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12 w-full">
          {plans.map((p) => {
            const featured = p.slug === 'growth'
            return (
              <div key={p.slug} className={`relative rounded-2xl border p-6 flex flex-col ${featured ? 'border-accent-500 bg-surface-elevated shadow-xl lg:scale-[1.03]' : 'border-border-default bg-surface-elevated'}`}>
                {featured && <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-accent-600 text-white text-xs font-semibold">Most popular</span>}
                <div className="text-xl font-bold">{p.name}</div>
                <div className="text-3xl font-extrabold mt-1">₹{Number(p.monthly_price_inr).toLocaleString('en-IN')}<span className="text-sm text-foreground-muted font-normal">/mo</span></div>
                <p className="text-sm text-foreground-secondary mt-3 min-h-[2.75rem]">{PLAN_BLURB[p.slug]}</p>
                <Link href="/signup" className={`mt-6 text-center px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${featured ? 'bg-accent-600 hover:bg-accent-700 text-white' : 'border border-border-default hover:bg-surface-secondary'}`}>Choose {p.name}</Link>
              </div>
            )
          })}
        </div>
        <div className="text-center mt-6"><Link href="/pricing" className="inline-flex items-center gap-1 text-accent-600 dark:text-accent-400 font-semibold hover:underline">Compare all features across plans →</Link></div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_120%,rgba(16,185,129,0.20),transparent)]" />
        <div className="w-full px-6 lg:px-12 py-24 text-center">
          <h2 className="text-5xl lg:text-6xl font-extrabold">Your store is one step away</h2>
          <p className="text-foreground-secondary mt-4 text-lg">Set it up in minutes. Start selling today.</p>
          <Link href="/signup" className="inline-block mt-8 px-8 py-4 rounded-lg bg-accent-600 hover:bg-accent-700 text-white font-semibold text-lg transition-colors shadow-lg shadow-accent-600/20">Get started free</Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border-default bg-surface-elevated">
        <div className="w-full px-6 lg:px-12 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-foreground-muted">
          <div className="flex items-center gap-2 font-bold text-foreground">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white text-xs">J</span>Jeffi Commerce
          </div>
          <div className="flex gap-6"><Link href="/pricing" className="hover:text-foreground">Pricing</Link><Link href="/signin" className="hover:text-foreground">Sign in</Link><Link href="/signup" className="hover:text-foreground">Get started</Link></div>
          <div>© 2026 Jeffi Commerce</div>
        </div>
      </footer>
    </div>
  )
}
