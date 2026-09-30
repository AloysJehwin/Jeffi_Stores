import { SECTION_COPY_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.business_cta

interface BusinessCtaProps {
  businessLandingUrl: string
  businessSignupUrl: string
  title?: string | null
  subtitle?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export default function BusinessCta({
  businessLandingUrl,
  businessSignupUrl,
  title,
  subtitle,
  ctaLabel,
  ctaUrl,
}: BusinessCtaProps) {
  return (
    <div className="px-3 sm:px-6 md:px-8 py-3 md:py-6 bg-surface">
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl min-h-[340px] md:min-h-[400px]"
        style={{ background: '#0d0d0d' }}
      >
        {/* Background image — right portion only, matching HeroCarousel */}
        <div className="absolute inset-0">
          <img
            src="/images/business-hero.webp"
            alt=""
            className="absolute right-0 top-0 h-full w-[70%] sm:w-[65%] object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-35% via-[#0d0d0d]/80 via-60% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
        </div>

        {/* Content — matches HeroCarousel text layout */}
        <div className="relative z-10 h-full flex flex-col justify-start pt-10 sm:pt-12 md:pt-14 px-6 sm:px-12 md:px-16 pb-16 max-w-[58%] sm:max-w-[52%] pointer-events-none space-y-4">
          <div className="inline-flex items-center gap-2 bg-accent-500/20 border border-accent-500/40 text-accent-400 text-[10px] font-black uppercase tracking-[0.18em] px-3 py-1.5 rounded-full w-fit">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
            {COPY.eyebrow}
          </div>

          <h2 className="text-2xl sm:text-3xl md:text-5xl font-black text-white leading-tight text-balance">
            {title || COPY.title}
          </h2>

          <p className="text-white/60 text-xs sm:text-sm leading-relaxed">{subtitle || COPY.subtitle}</p>

          <div className="flex flex-col gap-2 pt-1">
            {[
              {
                icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
                label: 'Tiered bulk pricing',
              },
              {
                icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
                label: 'GST-compliant invoices',
              },
              {
                icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
                label: '24h RFQ turnaround',
              },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2.5">
                <svg
                  className="w-3.5 h-3.5 text-accent-400 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span className="text-white/70 text-xs font-semibold">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-1 pointer-events-auto">
            <a
              href={ctaUrl || businessSignupUrl}
              className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-white font-black text-xs sm:text-sm px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-accent-500/25"
            >
              {ctaLabel || COPY.ctaLabel}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>
            <a
              href={businessLandingUrl}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl border border-white/15 transition-all"
            >
              Learn More
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
