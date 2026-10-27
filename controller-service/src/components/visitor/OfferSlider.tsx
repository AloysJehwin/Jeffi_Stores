'use client'

import Slides, { useSlide } from '@/components/visitor/slides/Slides'
import SlideImage from '@/components/visitor/slides/SlideImage'
import {
  BANNER_IMAGE,
  CARD_IMAGE,
  PromoBanner,
  PromoCard,
  PromoHeading,
  PromoMedia,
} from '@/components/visitor/slides/PromoCard'
import { offerHref, type ProductOffer } from '@/lib/catalog/product-offers-shared'

const PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1200" height="640"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'
const CARD_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'

interface Props {
  offers: ProductOffer[]
  title?: string | null
  eyebrow?: string | null
  /** Width / height of the cards, or of a lone offer's banner; null keeps the defaults. */
  aspect?: number | null
}

const shopLabel = (o: ProductOffer) => [`Shop ${o.title}`, o.badge_text, o.subtitle].filter(Boolean).join(', ')

// Several offers are 4:5 cards whose neighbours fade and shrink; a lone offer stays one wide banner.
export default function OfferSlider({ offers, title, eyebrow, aspect }: Props) {
  if (!offers.length) return null
  const single = offers.length === 1

  return (
    <section className="bg-surface px-3 sm:px-6 md:px-8 py-6 md:py-8">
      <PromoHeading eyebrow={eyebrow} title={title} />

      <Slides
        layout={single ? 'banner' : 'cards'}
        ariaLabel={title ?? 'Offers'}
        itemLabel="offer"
        aspect="4:5"
        aspectRatio={aspect}
        dots={{ label: i => `Go to offer ${i + 1}`, className: 'mt-3 justify-center' }}
      >
        {offers.map(o =>
          single ? <OfferBanner key={o.id} offer={o} aspect={aspect} /> : <OfferCard key={o.id} offer={o} />
        )}
      </Slides>
    </section>
  )
}

// Fills its slide; only the current card is reachable, the engine makes the neighbours inert.
function OfferCard({ offer }: { offer: ProductOffer }) {
  const { current, clone } = useSlide()
  return (
    <PromoCard
      href={offerHref(offer.slug)}
      label={shopLabel(offer)}
      tabIndex={clone ? -1 : undefined}
      backdrop={
        <PromoMedia
          card
          video={offer.video_url}
          videoCard={offer.video_url_card}
          poster={offer.image_url_card || offer.image_url || offer.image_url_mobile}
          alt={offer.title}
          active={current}
          className={CARD_IMAGE}
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
            className={CARD_IMAGE}
          />
        </PromoMedia>
      }
      badge={offer.badge_text}
      badgeClass={offer.badge_color}
      title={offer.title}
      sub={offer.subtitle}
      ctaLabel={offer.cta_label}
    />
  )
}

// A lone offer spans the row like the hero and business cards.
function OfferBanner({ offer, aspect }: { offer: ProductOffer; aspect?: number | null }) {
  return (
    <PromoBanner
      aspectRatio={aspect}
      href={offerHref(offer.slug)}
      label={`Shop ${offer.title}`}
      backdrop={
        <PromoMedia
          card={false}
          video={offer.video_url}
          videoCard={offer.video_url_card}
          poster={offer.image_url || offer.image_url_mobile}
          alt={offer.title}
          active
          className={BANNER_IMAGE}
        >
          <SlideImage
            src={offer.image_url}
            mobileSrc={offer.image_url_mobile}
            blurhash={offer.blurhash}
            blurhashMobile={offer.blurhash_mobile}
            placeholder={PLACEHOLDER}
            alt={offer.title}
            loading="eager"
            className={BANNER_IMAGE}
          />
        </PromoMedia>
      }
      badge={offer.badge_text}
      badgeClass={offer.badge_color}
      title={offer.title}
      sub={offer.subtitle}
      ctaLabel={offer.cta_label}
    />
  )
}
