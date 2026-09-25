import Link from 'next/link'
import { SECTION_COPY_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.about

interface AboutSectionProps {
  aboutCopy: string
  stats: { value: string; label: string }[]
  storeName: string
  title?: string | null
  eyebrow?: string | null
  body?: string | null
  imageUrl?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export default function AboutSection({
  aboutCopy, stats, storeName, title, eyebrow, body, imageUrl, ctaLabel, ctaUrl,
}: AboutSectionProps) {
  return (
    <section className="py-12 md:py-20 bg-surface">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-20 items-center">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl">
            <img
              src={imageUrl || COPY.imageUrl}
              alt={`${storeName} team`}
              className="w-full h-56 sm:h-80 md:h-[440px] object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-secondary-900/60 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex gap-3">
              {stats.map((s, i) => (
                <div key={i} className="bg-white/10 backdrop-blur-md rounded-xl px-4 py-3 border border-white/15 flex-1">
                  <p className="text-white font-black text-2xl">{s.value}</p>
                  <p className="text-white/60 text-xs font-semibold mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">{eyebrow || COPY.eyebrow}</p>
              <h2 className="text-2xl md:text-5xl font-black text-foreground leading-tight text-balance">
                {title || COPY.title}
              </h2>
            </div>
            <p className="text-sm md:text-base text-foreground-secondary leading-relaxed">
              {aboutCopy}
            </p>
            <p className="text-sm md:text-base text-foreground-secondary leading-relaxed">
              {body || COPY.body}
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={ctaUrl || COPY.ctaUrl}
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-xl font-bold transition-all text-sm shadow-lg shadow-primary-500/20"
              >
                {ctaLabel || COPY.ctaLabel}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 border border-border-default hover:border-primary-400 text-foreground px-6 py-3 rounded-xl font-bold transition-all text-sm"
              >
                Browse Products
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
