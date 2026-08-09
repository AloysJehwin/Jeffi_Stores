import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { bp } from '@/lib/business-path'
import BusinessPublicHeader from '@/components/business/PublicHeader'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'For Businesses — Jeffi Stores',
  description: 'Bulk pricing, GST-compliant invoices, RFQ flow, and dedicated support for procurement teams.',
}

export default async function BusinessLandingPage() {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  const token = (await cookies()).get('business_sid')?.value
  let authState: 'guest' | 'pending' | 'approved' | 'rejected' = 'guest'
  if (token) {
    const payload = await verifyToken(token).catch(() => null)
    if (payload?.isBusiness) {
      const status = (payload.approvalStatus as string | undefined) || 'approved'
      if (status === 'approved') authState = 'approved'
      else if (status === 'pending') authState = 'pending'
      else if (status === 'rejected') authState = 'rejected'
    }
  }

  return (
    <div className="bg-surface min-h-screen">
      <BusinessPublicHeader authState={authState} />

      <main className="pt-16 lg:pt-20">
        {/* Hero — carousel-card style */}
        <div className="px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl min-h-[420px] sm:min-h-[500px] md:min-h-[560px]" style={{ background: '#0d0d0d' }}>
            {/* Background image — right portion only */}
            <div className="absolute inset-0">
              <img
                src="/images/business-hero.webp"
                alt=""
                className="absolute right-0 top-0 h-full w-[70%] sm:w-[65%] object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-35% via-[#0d0d0d]/80 via-60% to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
            </div>

            {/* Text */}
            <div className="relative z-10 flex flex-col justify-start pt-10 sm:pt-14 md:pt-16 px-6 sm:px-12 md:px-16 pb-16 max-w-[75%] sm:max-w-[56%] md:max-w-[52%] space-y-4 sm:space-y-5">
              <span className="inline-flex items-center gap-2 self-start bg-accent-500/20 border border-accent-500/40 text-accent-400 text-[10px] font-black uppercase tracking-[0.18em] px-3 py-1.5 rounded-full whitespace-nowrap">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                For Procurement Teams
              </span>

              <h1 className="font-black text-white leading-[0.95] tracking-tight text-[clamp(2rem,5vw,4rem)]">
                Industrial supplies<br /><span className="text-accent-400">at business prices</span>
              </h1>

              <p className="text-white/60 text-xs sm:text-sm leading-relaxed max-w-[260px] sm:max-w-xs">
                Tiered discounts, GST-compliant invoicing, custom quotes, and a dedicated buying experience.
              </p>

              <div className="flex flex-col gap-2">
                {[
                  { icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', label: 'Tiered bulk pricing' },
                  { icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', label: 'GST-compliant invoices' },
                  { icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', label: '24h RFQ turnaround' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2.5">
                    <svg className="w-3.5 h-3.5 text-accent-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    <span className="text-white/70 text-xs font-semibold">{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  href={bp('/business/signup', host)}
                  className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-white font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-accent-500/25"
                >
                  Register Your Business
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
                <Link
                  href={bp('/business/signin', host)}
                  className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl border border-white/15 transition-all"
                >
                  Sign In
                </Link>
              </div>

              <p className="text-white/40 text-[10px]">Approval typically takes 1 business day.</p>
            </div>
          </div>
        </div>

        <section id="advantages" className="py-16 sm:py-20 border-b border-border-default">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">Why register as a business</h2>
              <p className="text-foreground-secondary">A separate portal designed for repeat procurement, GST workflows, and bulk negotiations.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                {
                  title: 'Tiered bulk pricing',
                  body: 'Approved buyers see category-level discounts on every product, applied automatically at checkout.',
                  icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
                },
                {
                  title: 'Custom RFQs',
                  body: 'Request a quote on any cart, negotiate prices in-thread with our team, and convert directly into an order.',
                  icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
                },
                {
                  title: 'GST-compliant invoices',
                  body: 'Every invoice is generated with your GSTIN, HSN codes, and proper tax breakdown. Download anytime.',
                  icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
                },
                {
                  title: 'Dedicated support',
                  body: 'Priority response on order issues, returns, and bulk dispatch. WhatsApp + email, no IVR.',
                  icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z',
                },
              ].map((f) => (
                <div key={f.title} className="bg-surface-elevated rounded-2xl border border-border-default p-6 hover:border-accent-500 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-accent-500/10 flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={f.icon} />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">{f.title}</h3>
                  <p className="text-sm text-foreground-secondary leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-16 sm:py-20 border-b border-border-default bg-surface-secondary">
          <div className="container mx-auto px-4 sm:px-6">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">How it works</h2>
              <p className="text-foreground-secondary">From sign-up to your first delivery — typically within a week.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
              {[
                { n: '1', t: 'Register', b: 'Sign up with your business email, GSTIN, and shipping address.' },
                { n: '2', t: 'Get verified', b: 'Our team verifies your details and applies category-level discounts.' },
                { n: '3', t: 'Browse or RFQ', b: 'Add products to cart at business prices, or request a custom quote.' },
                { n: '4', t: 'Order &amp; track', b: 'Pay or use approved credit. Track Delhivery delivery in real time.' },
              ].map((step) => (
                <div key={step.n} className="bg-surface-elevated rounded-2xl border border-border-default p-6">
                  <div className="w-10 h-10 rounded-full bg-accent-500 text-white font-extrabold flex items-center justify-center mb-3">{step.n}</div>
                  <h3 className="text-base font-bold text-foreground mb-1.5">{step.t}</h3>
                  <p className="text-sm text-foreground-secondary leading-relaxed" dangerouslySetInnerHTML={{ __html: step.b }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="py-16 sm:py-20 border-b border-border-default">
          <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">Frequently asked</h2>
            </div>
            <div className="space-y-3">
              {[
                {
                  q: 'How long does approval take?',
                  a: 'Typically 1 business day after we receive your GSTIN and verify the business address. You will get an email when your account is approved.',
                },
                {
                  q: 'Do I have to use credit?',
                  a: 'No. You can pay by Razorpay, UPI, or bank transfer per order. Net-30 credit is available on request once your account has a few completed orders.',
                },
                {
                  q: 'Can I get bulk pricing without registering?',
                  a: 'Catalog prices are available to everyone, but tiered category discounts and the RFQ flow are only available to approved business accounts.',
                },
                {
                  q: 'Is the catalog the same as the consumer storefront?',
                  a: 'Yes — same SKUs, same stock. The business portal layers on category discounts, GSTIN invoicing, and the quote-request workflow.',
                },
              ].map((item) => (
                <details key={item.q} className="group bg-surface-elevated rounded-xl border border-border-default p-4">
                  <summary className="flex items-center justify-between cursor-pointer list-none">
                    <span className="font-semibold text-foreground">{item.q}</span>
                    <svg className="w-5 h-5 text-foreground-secondary group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <p className="text-sm text-foreground-secondary leading-relaxed mt-3">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <div className="px-3 sm:px-6 md:px-8 py-3 md:py-6">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl py-16 sm:py-20 text-center" style={{ background: '#0d0d0d' }}>
            <div className="absolute inset-0">
              <img src="/images/business-hero.webp" alt="" className="absolute right-0 top-0 h-full w-[70%] sm:w-[65%] object-cover object-center opacity-40" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] via-[#0d0d0d]/90 to-[#0d0d0d]/60" />
            </div>
            <div className="relative z-10 container mx-auto px-4 sm:px-6">
              <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">Ready to start procuring?</h2>
              <p className="text-white/60 mb-8 max-w-xl mx-auto text-sm">Register in minutes. Approval is fast, and you only see business prices once verified.</p>
              <div className="flex flex-wrap gap-3 justify-center">
                <Link href={bp('/business/signup', host)} className="inline-flex items-center gap-2 px-7 py-3.5 bg-accent-500 hover:bg-accent-400 text-white font-black rounded-xl shadow-lg shadow-accent-500/25 transition-all text-sm">
                  Register Your Business
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
                <Link href={bp('/business/signin', host)} className="px-7 py-3.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl border border-white/15 transition-all text-sm">
                  Sign In
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
