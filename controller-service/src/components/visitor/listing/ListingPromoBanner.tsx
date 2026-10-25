import Link from 'next/link'
import SlideImage from '@/components/visitor/slides/SlideImage'
import { offerHref, pickPromoOffer, type PromoOffer } from '@/lib/catalog/product-offers-shared'

export { pickPromoOffer, type PromoOffer }

export default function ListingPromoBanner({ offer }: { offer: PromoOffer }) {
  const desktopImg = offer.image_url || offer.image_url_mobile
  const mobileImg = offer.image_url_mobile || offer.image_url
  if (!desktopImg || !mobileImg) return null
  const badgeClass = offer.badge_color?.startsWith('bg-') ? offer.badge_color : 'bg-accent-500'

  return (
    <Link
      href={offerHref(offer.slug)}
      aria-label={`Shop ${offer.title}`}
      className="group relative block w-full h-[clamp(9rem,26vw,13rem)] rounded-2xl overflow-hidden bg-[#0d0d0d] shadow-sm"
    >
      <SlideImage
        src={desktopImg}
        mobileSrc={mobileImg}
        blurhash={offer.blurhash}
        blurhashMobile={offer.blurhash_mobile}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.02]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-transparent" />
      <div className="relative z-10 h-full flex flex-col justify-center items-start gap-1.5 px-5 sm:px-8 max-w-[85%] sm:max-w-[60%]">
        {offer.badge_text && (
          <span
            className={`${badgeClass} text-white text-[10px] font-black uppercase tracking-[0.15em] px-2.5 py-1 rounded`}
          >
            {offer.badge_text}
          </span>
        )}
        <p className="font-black text-white leading-tight tracking-tight text-[clamp(1.1rem,2.6vw,1.75rem)]">
          {offer.title}
        </p>
        {offer.subtitle && (
          <p className="text-white/75 text-xs sm:text-sm leading-relaxed line-clamp-2">{offer.subtitle}</p>
        )}
        <span className="mt-1 bg-white text-black text-xs sm:text-sm font-bold px-3.5 py-1.5 rounded-lg">
          {offer.cta_label || 'Shop the offer'}
        </span>
      </div>
    </Link>
  )
}
