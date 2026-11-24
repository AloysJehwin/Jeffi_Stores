import Link from 'next/link'
import DemoStage from '../_demo/DemoStage'
import { FilmRow, FilmSound, HeroFilm } from '../_demo/DemoVideos'
import { DEMO_VIDEOS_READY, FEATURE_FILMS, HERO_FILM } from '../_demo/demo-videos'
import HowItWorks from '../_sections/HowItWorks'
import Faq from '../_sections/Faq'
import AppsGrid from '../_sections/AppsGrid'
import ApiServices from '../_sections/ApiServices'
import { REVIEW_TIME, fromLabel, loadPlanFacts, plansLine } from '../_sections/plan-facts'
import { Display, Pill } from '../_ui'
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

// The pricing teaser: the lowest plan price before GST, what it covers and the payment and shipping partners.
function PricingTeaser({ fromInr }: { fromInr: number | null }) {
  return (
    <section className="org-band w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-base opacity-80">{fromInr ? 'Plans from' : 'Pricing'}</p>
          <div className="mt-2 font-display font-black text-5xl sm:text-6xl lg:text-7xl leading-none">
            {fromInr ? (
              <>
                ₹{fromInr.toLocaleString('en-IN')}
                <span className="text-2xl lg:text-3xl">/mo + GST</span>
              </>
            ) : (
              'Paid monthly plans'
            )}
          </div>
          <p className="mt-4 sm:mt-5 text-base sm:text-lg opacity-80 max-w-2xl">
            The plan and your store&apos;s own server in one subscription, {REVIEW_TIME}. Works with Razorpay and Delhivery
            for payments and shipping.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Pill href="/signup" className="w-full sm:w-auto px-8 py-4 text-base">Start your store</Pill>
          <Link
            href="/pricing"
            className="font-display font-bold text-base underline underline-offset-4 hover:no-underline max-sm:flex max-sm:min-h-12 max-sm:items-center max-sm:justify-center"
          >
            Compare plans
          </Link>
        </div>
      </div>
    </section>
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
      <ApiServices />
      <PricingTeaser fromInr={fromInr} />

      <Faq
        domainAnswer={domainFaqAnswer(plans)}
        pricingNote={fromInr ? `Plans start at ${fromLabel(fromInr)}, and a new store goes live 1–2 business days after review.` : 'A new store goes live 1–2 business days after review.'}
      />
    </div>
  )
}
