import Link from 'next/link'
import SlideImage from '@/components/visitor/slides/SlideImage'
import StoreMedia from '@/components/visitor/media/StoreMedia'
import { bannerShape } from '@/components/visitor/slides/PromoCard'
import BannerSides from '@/components/visitor/home/BannerSides'
import type { SectionSides } from '@/lib/catalog/homepage-sections'

const MEDIA = 'absolute inset-0 w-full h-full object-cover object-center'
const BOX = 'group relative rounded-2xl overflow-hidden shadow-xl'

interface PromoBannerProps {
  title?: string | null
  subtitle?: string | null
  eyebrow?: string | null
  imageUrl?: string | null
  imageUrlMobile?: string | null
  blurhash?: string | null
  /** MP4/WebM over the image, its poster. */
  video?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  /** Banner shape (width / height); unset keeps the content-sized box. */
  aspect?: number | null
  /** Beside the banner when its shape narrows it. */
  sides?: SectionSides
}

export default function PromoBanner({
  title,
  subtitle,
  eyebrow,
  imageUrl,
  imageUrlMobile,
  blurhash,
  video,
  ctaLabel,
  ctaUrl,
  aspect,
  sides = 'plain',
}: PromoBannerProps) {
  const desktopImg = imageUrl ?? imageUrlMobile ?? null
  const mobileImg = imageUrlMobile ?? imageUrl ?? null
  const showCta = ctaUrl && ctaLabel

  if (!title && !subtitle && !eyebrow && !desktopImg && !showCta) return null

  return (
    <section className="py-8 md:py-12 bg-surface">
      <div className="container mx-auto px-4">
        <BannerSides sides={aspect ? sides : 'plain'} image={desktopImg}>
          <div
            className={aspect ? `${BOX} shape-box bg-[#0d0d0d]` : `${BOX} min-h-[14rem] md:min-h-[20rem] bg-[#0d0d0d]`}
            style={aspect ? bannerShape(aspect) : undefined}
          >
            {/* The whole banner is the link, so a short shape can drop the button. */}
            {showCta && (
              <Link
                href={ctaUrl}
                aria-label={ctaLabel}
                className="absolute inset-0 z-20 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
              />
            )}
            {mobileImg ? (
              <>
                <StoreMedia image={desktopImg} video={video} className={MEDIA}>
                  <SlideImage
                    src={desktopImg}
                    mobileSrc={mobileImg}
                    blurhash={blurhash}
                    breakpoint={1024}
                    className={MEDIA}
                  />
                </StoreMedia>
                <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-10% via-[#0d0d0d]/70 via-55% to-transparent" />
              </>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-primary-600 to-primary-800" />
            )}

            <div className="shape-short-tight relative z-10 h-full flex flex-col justify-center gap-3 px-6 sm:px-10 md:px-14 py-10 md:py-16 max-w-[90%] sm:max-w-[60%]">
              {eyebrow && (
                <p className="shape-short-hide text-white/70 text-[10px] font-black uppercase tracking-[0.2em]">{eyebrow}</p>
              )}
              {title && (
                <h2 className="shape-short-title font-black text-white leading-[1.05] tracking-tight text-[clamp(1.5rem,4vw,3rem)]">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="shape-short-hide text-white/60 text-sm md:text-base leading-relaxed max-w-lg">{subtitle}</p>
              )}
              {showCta && (
                <span
                  aria-hidden="true"
                  className="shape-shorter-hide inline-flex self-start items-center gap-2 mt-2 bg-white group-hover:bg-white/90 text-[#0d0d0d] px-6 py-3 rounded-xl font-bold transition-all shadow-lg text-sm md:text-base"
                >
                  {ctaLabel}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              )}
            </div>
          </div>
        </BannerSides>
      </div>
    </section>
  )
}
