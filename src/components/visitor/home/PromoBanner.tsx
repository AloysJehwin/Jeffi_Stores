import Link from 'next/link'
import BlurhashCanvas from '@/components/ui/BlurhashCanvas'

interface PromoBannerProps {
  title?: string | null
  subtitle?: string | null
  eyebrow?: string | null
  imageUrl?: string | null
  imageUrlMobile?: string | null
  blurhash?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export default function PromoBanner({
  title,
  subtitle,
  eyebrow,
  imageUrl,
  imageUrlMobile,
  blurhash,
  ctaLabel,
  ctaUrl,
}: PromoBannerProps) {
  const desktopImg = imageUrl ?? imageUrlMobile ?? null
  const mobileImg = imageUrlMobile ?? imageUrl ?? null
  const showCta = ctaUrl && ctaLabel

  if (!title && !subtitle && !eyebrow && !desktopImg && !showCta) return null

  return (
    <section className="py-8 md:py-12 bg-surface">
      <div className="container mx-auto px-4">
        <div className="relative rounded-2xl overflow-hidden shadow-xl min-h-[14rem] md:min-h-[20rem] bg-[#0d0d0d]">
          {mobileImg ? (
            <>
              {blurhash && <BlurhashCanvas hash={blurhash} />}
              <picture>
                <source media="(min-width: 1024px)" srcSet={desktopImg ?? mobileImg} />
                <img src={mobileImg} alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
              </picture>
              <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-10% via-[#0d0d0d]/70 via-55% to-transparent" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-primary-600 to-primary-800" />
          )}

          <div className="relative z-10 h-full flex flex-col justify-center gap-3 px-6 sm:px-10 md:px-14 py-10 md:py-16 max-w-[90%] sm:max-w-[60%]">
            {eyebrow && <p className="text-white/70 text-[10px] font-black uppercase tracking-[0.2em]">{eyebrow}</p>}
            {title && (
              <h2 className="font-black text-white leading-[1.05] tracking-tight text-[clamp(1.5rem,4vw,3rem)]">
                {title}
              </h2>
            )}
            {subtitle && <p className="text-white/60 text-sm md:text-base leading-relaxed max-w-lg">{subtitle}</p>}
            {showCta && (
              <Link
                href={ctaUrl}
                className="inline-flex self-start items-center gap-2 mt-2 bg-white hover:bg-white/90 text-[#0d0d0d] px-6 py-3 rounded-xl font-bold transition-all shadow-lg text-sm md:text-base"
              >
                {ctaLabel}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
