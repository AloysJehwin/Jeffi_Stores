import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { bp } from '@/lib/business-path'
import BusinessPublicHeader from '@/components/business/PublicHeader'
import ModelViewer from '@/components/ModelViewer'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'For Businesses — Jeffi Stores',
  description: 'Bulk pricing, GST-compliant invoices, RFQ flow, and dedicated support for procurement teams.',
}

export default async function BusinessLandingPage() {
  const host = (await headers()).get('host') ?? ''
  const token = cookies().get('business_auth_token')?.value
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
        <section className="relative bg-gradient-to-br from-secondary-700 via-secondary-600 to-secondary-800 overflow-hidden min-h-[calc(100svh-4rem)] flex items-center md:min-h-[calc(100vh-5rem)]">
          <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 md:py-16 relative z-10 w-full">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 lg:gap-20 items-center">

              <div className="md:order-1">
                <span className="inline-block bg-white/15 backdrop-blur-sm text-white font-bold uppercase tracking-widest rounded-full border border-white/30 text-[10px] sm:text-xs px-3 py-1.5 mb-4 md:mb-6">
                  For Procurement Teams
                </span>
                <h1 className="font-extrabold text-white leading-[1.05] tracking-tight mb-3 sm:mb-5 md:mb-6 text-[clamp(2.25rem,8vw,5rem)] md:text-[clamp(3rem,6vw,5.5rem)]">
                  Industrial supplies <span className="text-accent-400">at business prices</span>
                </h1>
                <p className="text-white/85 leading-relaxed mb-6 sm:mb-8 max-w-md md:max-w-none text-[clamp(0.875rem,2.5vw,1.25rem)] md:text-[clamp(1rem,2vw,1.4rem)]">
                  Open a Jeffi Stores Business account and get category-tier discounts, GST-compliant invoicing,
                  custom quotes for large orders, and a dedicated buying experience.
                </p>
                <div className="flex flex-wrap gap-3 mb-4 sm:mb-6">
                  <Link
                    href={bp('/business/signup')}
                    className="bg-accent-500 hover:bg-accent-600 text-white font-bold rounded-xl shadow-lg transition-all px-5 py-2.5 text-sm sm:px-7 sm:py-3 sm:text-base md:px-8 md:py-4 md:text-lg"
                  >
                    Register Your Business
                  </Link>
                  <Link
                    href={bp('/business/signin')}
                    className="bg-white/15 hover:bg-white/25 text-white font-semibold rounded-xl border border-white/40 transition-all px-5 py-2.5 text-sm sm:px-7 sm:py-3 sm:text-base md:px-8 md:py-4 md:text-lg"
                  >
                    Sign In
                  </Link>
                </div>
                <p className="text-white/60 text-xs sm:text-sm">Approval typically takes 1 business day after document verification.</p>
              </div>

              <div className="flex md:order-2 justify-center md:justify-end mt-4 md:mt-0">
                <div className="w-80 sm:w-96 md:w-full max-w-xl lg:max-w-2xl aspect-square">
                  <ModelViewer
                    src="/models/business-hero.glb"
                    alt="Tablet with business dashboard"
                    autoRotate
                    cameraOrbit="35deg 75deg 105%"
                    exposure={1.1}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

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

        <section className="py-16 sm:py-20 bg-secondary-600">
          <div className="container mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">Ready to start procuring?</h2>
            <p className="text-white/85 mb-8 max-w-xl mx-auto">Register in minutes. Approval is fast, and you only see business prices once verified.</p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link href={bp('/business/signup')} className="px-7 py-3.5 bg-accent-500 hover:bg-accent-600 text-white font-bold rounded-xl shadow-lg transition-colors">
                Register Your Business
              </Link>
              <Link href={bp('/business/signin')} className="px-7 py-3.5 bg-white/15 hover:bg-white/25 text-white font-semibold rounded-xl border border-white/40 transition-colors">
                Sign In
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
