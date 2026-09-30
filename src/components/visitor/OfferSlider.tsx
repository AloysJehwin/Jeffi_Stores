'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
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
    <section className="bg-surface px-3 sm:px-6 md:px-8 py-8 md:py-12">
      {(eyebrow || title) && (
        <div className="max-w-6xl mx-auto mb-5 md:mb-7 px-1">
          {eyebrow && (
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow}</p>
          )}
          {title && <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title}</h2>}
        </div>
      )}

      <div
        className="relative max-w-6xl mx-auto select-none"
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

          <div className="w-full sm:w-[70%] md:w-[64%] shrink-0">
            <OfferCard offer={current} priority />
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

function OfferCard({ offer, priority }: { offer: ProductOffer; priority?: boolean }) {
  const desktopImg = offer.image_url ?? offer.image_url_mobile ?? PLACEHOLDER
  const mobileImg = offer.image_url_mobile ?? offer.image_url ?? PLACEHOLDER
  const blurhash = offer.blurhash_mobile || offer.blurhash || null

  const card = (
    <div className="relative w-full h-[clamp(11rem,44vw,22rem)] rounded-2xl overflow-hidden shadow-xl bg-[#0d0d0d]">
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
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      </picture>
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-5 md:p-7 pointer-events-none">
        {offer.badge_text && (
          <span
            className={`inline-block text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded mb-3 ${offer.badge_color || 'bg-primary-500'}`}
          >
            {offer.badge_text}
          </span>
        )}
        <h3 className="font-black text-white leading-tight tracking-tight text-[clamp(1.25rem,3.2vw,2.25rem)]">
          {offer.title}
        </h3>
        {offer.subtitle && (
          <p className="text-white/70 text-xs sm:text-sm leading-relaxed mt-1 max-w-md">{offer.subtitle}</p>
        )}
        {offer.cta_label && (
          <span className="inline-block mt-3 bg-white text-black text-xs sm:text-sm font-bold px-4 py-2 rounded-lg">
            {offer.cta_label}
          </span>
        )}
      </div>
    </div>
  )

  if (!priority) return card

  return (
    <Link href={offerHref(offer.slug)} aria-label={`Shop ${offer.title}`} className="block">
      {card}
    </Link>
  )
}
