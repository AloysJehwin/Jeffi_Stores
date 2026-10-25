'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import Slides, { useSlide } from '@/components/visitor/slides/Slides'
import SlideImage from '@/components/visitor/slides/SlideImage'
import { offerHref, type ProductOffer } from '@/lib/catalog/product-offers-shared'

const PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="640"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'
const CARD_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'

interface Props {
  offers: ProductOffer[]
  title?: string | null
  eyebrow?: string | null
}

const shopLabel = (o: ProductOffer) => [`Shop ${o.title}`, o.badge_text, o.subtitle].filter(Boolean).join(', ')

// Several offers are 4:5 cards whose neighbours fade and shrink; a lone offer stays one wide banner.
export default function OfferSlider({ offers, title, eyebrow }: Props) {
  if (!offers.length) return null
  const single = offers.length === 1

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

      <Slides
        layout={single ? 'banner' : 'cards'}
        ariaLabel={title ?? 'Offers'}
        itemLabel="offer"
        aspect="4:5"
        dots={{ label: i => `Go to offer ${i + 1}`, className: 'mt-3 justify-center' }}
      >
        {offers.map(o => (single ? <OfferBanner key={o.id} offer={o} /> : <OfferCard key={o.id} offer={o} />))}
      </Slides>
    </section>
  )
}

// Fills its slide; only the current card is reachable, the engine makes the neighbours inert.
function OfferCard({ offer }: { offer: ProductOffer }) {
  const { current, clone } = useSlide()
  return (
    <Link
      href={offerHref(offer.slug)}
      aria-label={shopLabel(offer)}
      tabIndex={clone ? -1 : undefined}
      className="group relative block h-full w-full overflow-hidden rounded-2xl bg-[#0d0d0d] shadow-md transition-[transform,box-shadow] duration-300 ease-out hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <SlideImage
        card
        cardSrc={offer.image_url_card}
        src={offer.image_url}
        mobileSrc={offer.image_url_mobile}
        blurhashCard={offer.blurhash_card}
        blurhash={offer.blurhash}
        blurhashMobile={offer.blurhash_mobile}
        placeholder={CARD_PLACEHOLDER}
        alt={offer.title}
        loading={current ? 'eager' : 'lazy'}
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.04]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 via-45% to-transparent" />

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-start p-5 md:p-6">
        {offer.badge_text && (
          <span
            className={`mb-3 text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-full ${offer.badge_color || 'bg-primary-500'}`}
          >
            {offer.badge_text}
          </span>
        )}
        <h3 className="line-clamp-3 text-[clamp(1.25rem,1rem+1vw,1.75rem)] font-black leading-[1.1] tracking-tight text-white">
          {offer.title}
        </h3>
        {offer.subtitle && <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-white/75">{offer.subtitle}</p>}
        {offer.cta_label && (
          <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-900 shadow-sm sm:text-sm">
            {offer.cta_label}
            <ArrowRight
              className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        )}
      </div>
    </Link>
  )
}

// A lone offer spans the row like the hero and business cards.
function OfferBanner({ offer }: { offer: ProductOffer }) {
  return (
    <Link
      href={offerHref(offer.slug)}
      aria-label={`Shop ${offer.title}`}
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
    >
      <div className="relative w-full overflow-hidden rounded-2xl bg-[#0d0d0d] h-[clamp(14rem,40vw,28rem)] shadow-2xl">
        <SlideImage
          src={offer.image_url}
          mobileSrc={offer.image_url_mobile}
          blurhash={offer.blurhash}
          blurhashMobile={offer.blurhash_mobile}
          placeholder={PLACEHOLDER}
          alt={offer.title}
          loading="eager"
          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        <div className="absolute inset-x-0 bottom-0 pointer-events-none p-6 sm:p-10 lg:p-14">
          {offer.badge_text && (
            <span
              className={`inline-block text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-full mb-3 ${offer.badge_color || 'bg-primary-500'}`}
            >
              {offer.badge_text}
            </span>
          )}
          <h3 className="max-w-2xl font-black text-white leading-[1.05] tracking-tight text-[clamp(1.75rem,4.4vw,3.75rem)]">
            {offer.title}
          </h3>
          {offer.subtitle && (
            <p className="mt-2 max-w-md leading-relaxed text-white/80 text-sm sm:text-base">{offer.subtitle}</p>
          )}
          {offer.cta_label && (
            <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-900 shadow-sm sm:px-5 sm:py-2.5 sm:text-sm">
              {offer.cta_label}
              <ArrowRight
                className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
