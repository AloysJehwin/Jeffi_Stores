'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import BlurhashCanvas from '@/components/ui/BlurhashCanvas'
import { offerHref, type ProductOffer } from '@/lib/catalog/product-offers-shared'

const PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="640"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'
const SWIPE_THRESHOLD = 50 // px

interface Props {
  offers: ProductOffer[]
  title?: string | null
  eyebrow?: string | null
}

export default function OfferSlider({ offers, title, eyebrow }: Props) {
  const [active, setActive] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const touchDeltaX = useRef(0)

  const count = offers.length
  const go = useCallback((next: number) => setActive(((next % count) + count) % count), [count])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
  }
  const onTouchEnd = () => {
    const dx = touchDeltaX.current
    if (Math.abs(dx) > SWIPE_THRESHOLD) go(active + (dx < 0 ? 1 : -1))
    touchStartX.current = null
    touchDeltaX.current = 0
  }

  if (!count) return null

  const single = count === 1
  const prev = offers[(active - 1 + count) % count]
  const current = offers[active]
  const next = offers[(active + 1) % count]

  return (
    <section className="bg-surface px-3 sm:px-6 md:px-8 py-6 md:py-8">
      {(eyebrow || title) && (
        <div className="mb-5 md:mb-7 px-1">
          {eyebrow && (
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow}</p>
          )}
          {title && <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title}</h2>}
        </div>
      )}

      <div
        className="relative select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onKeyDown={e => {
          if (single) return
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            go(active - 1)
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            go(active + 1)
          }
        }}
        tabIndex={single ? -1 : 0}
        role="group"
        aria-roledescription="carousel"
        aria-label={title ?? 'Offers'}
      >
        <div className="flex items-center justify-center gap-3 md:gap-5">
          {!single && <OfferPeek offer={prev} onClick={() => go(active - 1)} side="left" />}

          <div className={single ? 'w-full' : 'w-full sm:w-[70%] md:w-[64%] shrink-0'}>
            <OfferCard offer={current} priority wide={single} />
          </div>

          {!single && <OfferPeek offer={next} onClick={() => go(active + 1)} side="right" />}
        </div>

        {!single && (
          <>
            <button
              type="button"
              onClick={() => go(active - 1)}
              aria-label="Previous offer"
              className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 z-20 grid place-items-center h-9 w-9 md:h-11 md:w-11 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go(active + 1)}
              aria-label="Next offer"
              className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 z-20 grid place-items-center h-9 w-9 md:h-11 md:w-11 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            <div className="mt-4 flex items-center justify-center gap-2">
              {offers.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Go to offer ${i + 1}`}
                  className={`rounded-full transition-all duration-300 ${i === active ? 'bg-primary-500 w-5 h-2' : 'bg-foreground/20 hover:bg-foreground/40 w-2 h-2'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// The two neighbours are clipped to half their width so they peek in from the edges.
function OfferPeek({ offer, onClick, side }: { offer: ProductOffer; onClick: () => void; side: 'left' | 'right' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-hidden="true"
      tabIndex={-1}
      className={`hidden sm:block relative shrink-0 w-[18%] h-[clamp(9rem,20vw,15rem)] overflow-hidden rounded-xl opacity-45 hover:opacity-70 transition-opacity ${side === 'left' ? '' : ''}`}
    >
      <div className={`absolute top-0 h-full w-[280%] ${side === 'left' ? 'right-0' : 'left-0'}`}>
        <OfferCard offer={offer} />
      </div>
    </button>
  )
}

// `wide`: a lone offer spans the row like the hero and business cards, so it gets more height and room.
function OfferCard({ offer, priority, wide }: { offer: ProductOffer; priority?: boolean; wide?: boolean }) {
  const desktopImg = offer.image_url ?? offer.image_url_mobile ?? PLACEHOLDER
  const mobileImg = offer.image_url_mobile ?? offer.image_url ?? PLACEHOLDER
  const blurhash = offer.blurhash_mobile || offer.blurhash || null

  const card = (
    <div
      className={`relative w-full overflow-hidden rounded-2xl bg-[#0d0d0d] shadow-xl ${wide ? 'h-[clamp(14rem,40vw,28rem)] shadow-2xl' : 'h-[clamp(11rem,44vw,22rem)]'}`}
    >
      {blurhash && (
        <div className="absolute inset-0">
          <BlurhashCanvas hash={blurhash} />
        </div>
      )}
      <picture>
        <source media="(min-width: 640px)" srcSet={desktopImg} />
        <img
          src={mobileImg}
          alt={offer.title}
          loading={priority ? 'eager' : 'lazy'}
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.03]"
        />
      </picture>
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

      <div className={`absolute inset-x-0 bottom-0 pointer-events-none ${wide ? 'p-6 sm:p-10 lg:p-14' : 'p-5 md:p-7'}`}>
        {offer.badge_text && (
          <span
            className={`inline-block text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-full mb-3 ${offer.badge_color || 'bg-primary-500'}`}
          >
            {offer.badge_text}
          </span>
        )}
        <h3
          className={`max-w-2xl font-black text-white leading-[1.05] tracking-tight ${wide ? 'text-[clamp(1.75rem,4.4vw,3.75rem)]' : 'text-[clamp(1.25rem,3.2vw,2.25rem)]'}`}
        >
          {offer.title}
        </h3>
        {offer.subtitle && (
          <p className={`mt-2 max-w-md leading-relaxed text-white/80 ${wide ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'}`}>{offer.subtitle}</p>
        )}
        {offer.cta_label && (
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-900 shadow-sm sm:px-5 sm:py-2.5 sm:text-sm">
            {offer.cta_label}
            <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  )

  if (!priority) return card

  return (
    <Link href={offerHref(offer.slug)} aria-label={`Shop ${offer.title}`} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
      {card}
    </Link>
  )
}
