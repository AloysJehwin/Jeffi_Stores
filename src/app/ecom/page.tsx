import Link from 'next/link'
import { PhoneMock, Gear, Coin, TrendUp, Dots } from './Shapes'
import DemoStage from './_demo/DemoStage'
import LandingFeatures from './_demo/LandingFeatures'
import HowItWorks from './_sections/HowItWorks'
import Faq from './_sections/Faq'
import AppsGrid from './_sections/AppsGrid'
import FeatureGrid from './_sections/FeatureGrid'

export const dynamic = 'force-dynamic'

export default function EcomLandingPage() {
  return (
    <div className="ecom-clean bg-[#eef1f5] text-foreground relative isolate">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden border-b border-border-default">
        <div className="w-full px-6 lg:px-12 pt-12 pb-10 sm:pt-24 text-center">
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-foreground">
            Sell anything.<br />
            <span className="ecom-accent-text">We run the store.</span>
          </h1>
          <p className="mt-6 text-lg text-foreground-secondary max-w-2xl mx-auto">
            A complete online store on your own subdomain — storefront, admin, payments, delivery and GST, managed for you.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="ecom-accent-bg w-full sm:w-auto px-7 py-3.5 rounded-lg text-white font-semibold transition-colors"
            >
              Start your store
            </Link>
          </div>
        </div>

        {/* live demo centrepiece — white card on the grey page for separation */}
        <div id="demo-stage" className="w-full px-4 sm:px-6 lg:px-10 pb-16 scroll-mt-24">
          <div className="rounded-2xl bg-surface-elevated border border-border-default shadow-xl shadow-black/[0.06] p-3 sm:p-4">
            <DemoStage />
          </div>
        </div>
      </section>

      {/* ── Trust bar ── */}
      <section className="border-b border-border-default bg-surface-elevated">
        <div className="w-full px-6 lg:px-12 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            ['Storefront + Admin', 'one platform'],
            ['Online + COD', 'payments built in'],
            ['Delhivery', 'delivery & tracking'],
            ['GST-ready', 'invoicing'],
          ].map(([a, b]) => (
            <div key={a}>
              <div className="text-lg sm:text-xl font-bold text-foreground">{a}</div>
              <div className="text-xs text-foreground-muted mt-0.5">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <HowItWorks />

      {/* ── Apps grid (every app, one login) ── */}
      <AppsGrid />

      {/* ── Feature grid (everything included) ── */}
      <FeatureGrid />

      {/* ── Feature highlights (scrub the demo) ── */}
      <section className="w-full px-6 lg:px-12 py-16">
        <div className="text-center mb-10">
          <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">The whole loop</p>
          <h2 className="text-4xl lg:text-5xl font-extrabold mt-3 text-foreground">One platform, end to end</h2>
          <p className="text-foreground-secondary mt-3 text-lg">Tap a step to jump straight to it in the demo above.</p>
        </div>
        <LandingFeatures />
      </section>

      {/* ── Mobile bento ── */}
      <section className="relative w-full px-6 lg:px-12 py-20 bg-surface-elevated border-y border-border-default overflow-hidden">
        <Gear className="ecom-accent-text hidden md:block absolute -left-6 top-16 w-24 h-24 opacity-10" />
        <Coin className="ecom-accent-text hidden md:block absolute right-16 top-24 w-16 h-16 opacity-10" />
        <TrendUp className="ecom-accent-text hidden md:block absolute right-1/3 bottom-10 w-20 h-20 opacity-10" />
        <Dots className="hidden md:block absolute right-8 bottom-16 w-28 h-28 text-foreground/10" />

        <div className="relative w-full text-center mb-12">
          <p className="ecom-accent-text font-semibold text-sm uppercase tracking-widest">Built for mobile commerce</p>
          <h2 className="text-4xl lg:text-5xl font-extrabold mt-3 text-foreground">Your store, in every pocket</h2>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5 w-full items-stretch">
          <div className="md:col-span-2 rounded-3xl border border-border-default bg-surface p-8 flex flex-col sm:flex-row items-center gap-8">
            <PhoneMock variant="store" />
            <div className="max-w-xs">
              <h3 className="text-2xl font-bold text-foreground">A storefront that sells itself</h3>
              <p className="text-foreground-secondary mt-2">
                Fast, mobile-first shopping — catalogue, search, cart and checkout tuned for conversion on any device.
              </p>
            </div>
          </div>
          <div className="ecom-accent-bg relative rounded-3xl text-white p-6 flex flex-col justify-between overflow-hidden">
            <Coin className="absolute -right-4 -bottom-4 w-28 h-28 text-white/15" />
            <div className="relative text-5xl font-extrabold leading-none">Rs. 0</div>
            <p className="relative text-sm text-white/90">setup cost · go live today</p>
          </div>
          <div className="rounded-3xl border border-border-default bg-surface p-8 flex flex-col items-center text-center">
            <PhoneMock variant="card" className="w-[150px]" />
            <h3 className="text-lg font-bold mt-5 text-foreground">Payments, settled for you</h3>
            <p className="text-sm text-foreground-secondary mt-1">Online & COD split automatically.</p>
          </div>
          <div className="md:col-span-2 rounded-3xl border border-border-default bg-surface p-8 flex flex-col sm:flex-row-reverse items-center gap-8">
            <PhoneMock variant="chart" />
            <div className="max-w-xs">
              <h3 className="text-2xl font-bold text-foreground">Insights on the go</h3>
              <p className="text-foreground-secondary mt-2">
                Revenue, orders and stock at a glance — manage the whole business from your phone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <Faq />

      {/* ── Integrations strip ── */}
      <section className="w-full px-6 lg:px-12 py-12">
        <p className="text-center text-sm text-foreground-muted uppercase tracking-widest mb-8">Powered by the tools you trust</p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 w-full">
          {['Razorpay', 'Delhivery', 'GST / GSTN', 'Google', 'AWS'].map((n) => (
            <span key={n} className="text-xl font-bold text-foreground-muted/70">{n}</span>
          ))}
        </div>
      </section>

      {/* ── Metrics band ── */}
      <section className="w-full px-6 lg:px-12 py-16 bg-foreground text-surface">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 w-full text-center">
          {[
            ['Minutes', 'to go live'],
            ['100%', 'storefront on every plan'],
            ['Online + COD', 'payments handled'],
            ['GST-ready', 'invoicing'],
          ].map(([a, b]) => (
            <div key={a}>
              <div className="text-4xl lg:text-5xl font-extrabold">{a}</div>
              <div className="text-surface/70 text-sm mt-2">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative overflow-hidden border-t border-border-default">
        <div className="w-full px-6 lg:px-12 py-24 text-center">
          <h2 className="text-5xl lg:text-6xl font-extrabold text-foreground">Your store is one step away</h2>
          <p className="text-foreground-secondary mt-4 text-lg">Set it up in minutes. Start selling today.</p>
          <Link
            href="/signup"
            className="ecom-accent-bg inline-block mt-8 px-8 py-4 rounded-lg text-white font-semibold text-lg transition-colors"
          >
            Get started free
          </Link>
        </div>
      </section>
    </div>
  )
}
