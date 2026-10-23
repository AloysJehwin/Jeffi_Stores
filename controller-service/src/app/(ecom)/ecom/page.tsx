import { PhoneMock } from './Shapes'
import DemoStage from './_demo/DemoStage'
import LandingFeatures from './_demo/LandingFeatures'
import HowItWorks from './_sections/HowItWorks'
import Faq from './_sections/Faq'
import AppsGrid from './_sections/AppsGrid'
import FeatureGrid from './_sections/FeatureGrid'
import ApiServices from './_sections/ApiServices'
import { Eyebrow, Display, Pill, SandCard } from './_ui'

export const dynamic = 'force-dynamic'

export default function EcomLandingPage() {
  return (
    <div className="bg-surface text-foreground relative isolate overflow-hidden">
      {/* ── Hero ── */}
      <section className="relative">
        <div aria-hidden className="org-sage absolute -top-24 -right-36 w-[300px] h-[300px] rounded-full opacity-80 sm:-top-40 sm:-right-24 sm:w-[560px] sm:h-[560px]" />
        <div className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-10 sm:pt-28 sm:pb-12">
          <Display as="h1" className="text-5xl sm:text-7xl lg:text-8xl max-w-4xl">
            Sell anything.
            <br />
            <span className="ecom-accent-text">We run the store.</span>
          </Display>
          <p className="mt-5 sm:mt-8 text-lg sm:text-xl text-foreground-secondary max-w-2xl leading-relaxed">
            A complete online store on your own subdomain — storefront, admin, payments, delivery and GST, managed for
            you.
          </p>
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
            <Pill href="/signup" className="w-full sm:w-auto px-8 py-4 text-base">Start your store</Pill>
            <a
              href="#demo-stage"
              className="font-display font-bold text-base ecom-accent-text hover:underline max-sm:flex max-sm:min-h-12 max-sm:items-center max-sm:justify-center max-sm:rounded-full max-sm:bg-[var(--org-sand)]"
            >
              See the demo
            </a>
          </div>
        </div>

        <div id="demo-stage" className="relative w-full px-4 sm:px-6 lg:px-12 pb-14 sm:pb-20 scroll-mt-24">
          <DemoStage />
        </div>
      </section>

      <HowItWorks />
      <AppsGrid />
      <FeatureGrid />
      <ApiServices />

      {/* ── The whole loop ── */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
        <Eyebrow>The whole loop</Eyebrow>
        <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl max-w-xl">One platform, end to end</Display>
        <p className="text-foreground-secondary mt-4 text-base sm:text-lg">Tap a step to jump straight to it in the demo above.</p>
        <div className="mt-8 sm:mt-10">
          <LandingFeatures />
        </div>
      </section>

      {/* ── Mobile bento ── */}
      <section className="relative w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
        <div aria-hidden className="org-peach absolute left-0 top-24 w-24 h-24 rounded-full -translate-x-1/2 hidden sm:block" />
        <div aria-hidden className="org-sage absolute right-0 bottom-10 w-72 h-72 rounded-full translate-x-1/3 opacity-70 hidden sm:block" />
        <Eyebrow>Built for mobile commerce</Eyebrow>
        <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl max-w-xl">Your store, in every pocket</Display>

        <div className="relative mt-8 sm:mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 w-full">
          <SandCard className="overflow-hidden sm:min-h-[480px] flex flex-col max-sm:p-5">
            <h3 className="font-display font-black text-xl sm:text-2xl text-foreground">A storefront that sells itself</h3>
            <p className="mt-2 text-base text-foreground-secondary max-w-md">
              Fast, mobile-first shopping — catalogue, search, cart and checkout tuned for conversion on any device.
            </p>
            <PhoneMock variant="store" className="mx-auto mt-5 sm:mt-6 -mb-24 max-sm:w-[160px]" />
          </SandCard>
          <SandCard tone="terracotta" className="min-h-[220px] sm:min-h-[480px] flex flex-col justify-end max-sm:p-5">
            <div className="font-display font-black text-6xl lg:text-7xl leading-none" style={{ color: 'var(--org-band-text)' }}>Rs. 0</div>
            <p className="mt-3 text-base text-white/90">setup cost · go live today</p>
          </SandCard>
          <SandCard className="overflow-hidden sm:min-h-[480px] flex flex-col max-sm:p-5">
            <h3 className="font-display font-black text-xl sm:text-2xl text-foreground">Payments, settled for you</h3>
            <p className="mt-2 text-base text-foreground-secondary">Online & COD split automatically.</p>
            <PhoneMock variant="card" className="mx-auto mt-5 sm:mt-6 -mb-24 max-sm:w-[160px]" />
          </SandCard>
          <SandCard className="overflow-hidden sm:min-h-[480px] flex flex-col max-sm:p-5">
            <h3 className="font-display font-black text-xl sm:text-2xl text-foreground">Insights on the go</h3>
            <p className="mt-2 text-base text-foreground-secondary max-w-md">
              Revenue, orders and stock at a glance — manage the whole business from your phone.
            </p>
            <PhoneMock variant="chart" className="mx-auto mt-5 sm:mt-6 -mb-24 max-sm:w-[160px]" />
          </SandCard>
        </div>
      </section>

      <Faq />

      {/* ── Integrations ── */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-10 sm:py-12">
        <p className="text-sm text-foreground-muted uppercase tracking-widest mb-4 sm:mb-6">Powered by the tools you trust</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:gap-x-12 sm:gap-y-4">
          {['Razorpay', 'Delhivery', 'GST / GSTN', 'Google', 'AWS'].map(n => (
            <span key={n} className="font-display font-black text-xl sm:text-2xl text-foreground/50">{n}</span>
          ))}
        </div>
      </section>

      {/* ── Metrics band ── */}
      <section className="org-band w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8 sm:gap-10 w-full">
          {[
            ['Minutes', 'to go live'],
            ['100%', 'storefront on every plan'],
            ['Online + COD', 'payments handled'],
            ['GST-ready', 'invoicing'],
          ].map(([a, b]) => (
            <div key={a} className="min-w-0">
              <div className="font-display font-black text-3xl sm:text-4xl lg:text-6xl leading-none break-words">{a}</div>
              <div className="text-sm mt-3 sm:mt-4 opacity-80">{b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-16 sm:py-28 text-center">
        <Display className="text-4xl sm:text-5xl lg:text-7xl max-w-3xl mx-auto">Your store is one step away</Display>
        <p className="text-foreground-secondary mt-4 sm:mt-6 text-base sm:text-lg">Set it up in minutes. Start selling today.</p>
        <Pill href="/signup" className="mt-8 sm:mt-10 w-full sm:w-auto px-8 py-4 text-base">Get started free</Pill>
      </section>
    </div>
  )
}
