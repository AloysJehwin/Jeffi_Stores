import Link from 'next/link'
import { Star } from 'lucide-react'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import type { Testimonial } from '@/lib/catalog/homepage-extras'
import { SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.testimonials

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`Rated ${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-4 h-4 ${i <= rating ? 'fill-amber-400 text-amber-400' : 'text-border-secondary'}`}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <figure className="h-full flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-elevated p-5">
      <Stars rating={t.rating} />
      {t.title && <p className="font-semibold text-foreground">{t.title}</p>}
      <blockquote className="flex-1 text-sm text-foreground-secondary leading-relaxed line-clamp-6">
        &ldquo;{t.comment}&rdquo;
      </blockquote>
      <figcaption className="pt-3 border-t border-border-default text-xs">
        <span className="font-semibold text-foreground">{t.author}</span>
        {t.verified && <span className="ml-2 text-accent-600 dark:text-accent-400">Verified purchase</span>}
        <Link
          href={`/products/${t.productSlug}`}
          className="block mt-1 text-foreground-muted hover:text-accent-600 truncate"
        >
          {t.productName}
        </Link>
      </figcaption>
    </figure>
  )
}

interface TestimonialWallProps {
  items: Testimonial[]
  eyebrow?: string | null
  title?: string | null
  carousel?: boolean
}

export default function TestimonialWall({ items, eyebrow, title, carousel = false }: TestimonialWallProps) {
  const heading = title ?? COPY.title
  return (
    <section className="py-12 md:py-16 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <div className="mb-7">
          <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
            {eyebrow ?? COPY.eyebrow}
          </p>
          <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{heading}</h2>
        </div>
        {carousel ? (
          <SectionCarousel ariaLabel={heading}>
            {items.map(t => (
              <TestimonialCard key={t.id} t={t} />
            ))}
          </SectionCarousel>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(t => (
              <TestimonialCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
