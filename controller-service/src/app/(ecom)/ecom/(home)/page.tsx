import Link from 'next/link'
import { PhoneMock } from '../Shapes'
import DemoStage from '../_demo/DemoStage'
import { FilmRow, FilmSound, HeroFilm } from '../_demo/DemoVideos'
import { DEMO_VIDEOS_READY, FEATURE_FILMS, HERO_FILM } from '../_demo/demo-videos'
import LandingFeatures from '../_demo/LandingFeatures'
import HowItWorks from '../_sections/HowItWorks'
import Faq from '../_sections/Faq'
import AppsGrid from '../_sections/AppsGrid'
import FeatureGrid from '../_sections/FeatureGrid'
import ApiServices from '../_sections/ApiServices'
import { fromLabel, loadPlanFacts, plansLine } from '../_sections/plan-facts'
import { Eyebrow, Display, Pill, SandCard } from '../_ui'
import { appPlanTags } from '../apps'
import { domainFaqAnswer } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

function HeroCopy({ beside, facts }: { beside?: boolean; facts: string }) {
  return (
    <div>
      <Display as="h1" className={beside ? 'text-5xl sm:text-7xl lg:text-7xl xl:text-8xl max-w-4xl' : 'text-5xl sm:text-7xl lg:text-8xl max-w-4xl'}>
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
          {beside ? 'Try the live demo' : 'See the demo'}
        </a>
      </div>
      <p className="mt-4 text-sm text-foreground-muted max-sm:text-center">{facts}</p>
    </div>
  )
}

export default async function EcomLandingPage() {
  const { plans, matrix, fromInr } = await loadPlanFacts()
  const facts = plansLine(fromInr)
  return (
    <div className="bg-surface text-foreground relative isolate overflow-hidden">
      {/* ── Hero ── */}
      <section className="relative">
        <div aria-hidden className="org-sage absolute -top-24 -right-36 w-[300px] h-[300px] rounded-full opacity-80 sm:-top-40 sm:-right-24 sm:w-[560px] sm:h-[560px]" />
        {DEMO_VIDEOS_READY ? (
          <FilmSound>
            <div className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-8 sm:pt-24 sm:pb-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center">
              <HeroCopy beside facts={facts} />
              <HeroFilm film={HERO_FILM} />
            </div>
            <div className="relative w-full px-4 sm:px-6 lg:px-12 pb-12 sm:pb-16">
              <FilmRow films={FEATURE_FILMS} />
            </div>
          </FilmSound>
        ) : (
          <div className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-10 sm:pt-28 sm:pb-12">
            <HeroCopy facts={facts} />
          </div>
        )}

        <div id="demo-stage" className="relative w-full px-4 sm:px-6 lg:px-12 pb-14 sm:pb-20 scroll-mt-24">
          <DemoStage />
        </div>
      </section>

      <HowItWorks fromInr={fromInr} />
      <AppsGrid tags={appPlanTags(plans, matrix)} />
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
            <p className="text-base text-white/90">{fromInr ? 'Plans from' : 'Going live'}</p>
            <div className="mt-2 font-display font-black text-6xl lg:text-7xl leading-none" style={{ color: 'var(--org-band-text)' }}>
              {fromInr ? (
                <>
                  ₹{fromInr.toLocaleString('en-IN')}
                  <span className="text-2xl lg:text-3xl">/mo</span>
                </>
              ) : (
                '1–2'
              )}
            </div>
            <p className="mt-3 text-base text-white/90">{fromInr ? 'Live 1–2 business days after review.' : 'Business days from review to a live store.'}</p>
            <Link href="/pricing" className="mt-4 self-start text-sm font-semibold text-white underline underline-offset-4 hover:no-underline">Compare plans</Link>
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

      <Faq
        domainAnswer={domainFaqAnswer(plans)}
        pricingNote={fromInr ? `Plans start at ${fromLabel(fromInr)}, and a new store goes live 1–2 business days after review.` : 'A new store goes live 1–2 business days after review.'}
      />

      {/* ── Integrations ── */}
      <section className="w-full px-4 sm:px-6 lg:px-12 py-10 sm:py-12">
        <p className="text-base sm:text-lg text-foreground-secondary">
          Works with <span className="font-semibold text-foreground">Razorpay</span> and{' '}
          <span className="font-semibold text-foreground">Delhivery</span> for payments and shipping.
        </p>
      </section>

      {/* ── Metrics band ── */}
      <section className="org-band w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8 sm:gap-10 w-full">
          {[
            ['1–2', 'business days from review to a live store'],
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
        <p className="text-foreground-secondary mt-4 sm:mt-6 text-base sm:text-lg">{facts}</p>
        <div className="mt-8 sm:mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
          <Pill href="/signup" className="w-full sm:w-auto px-8 py-4 text-base">Start your store</Pill>
          <Pill tone="ghost" href="/pricing" className="text-base max-sm:min-h-12">Compare plans</Pill>
        </div>
      </section>
    </div>
  )
}
