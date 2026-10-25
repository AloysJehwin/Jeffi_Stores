'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import Slides from '@/components/visitor/slides/Slides'
import SlideImage from '@/components/visitor/slides/SlideImage'

export interface HeroSlide {
  // New DB-backed shape
  id?: string
  title?: string
  subtitle?: string | null
  badge_text?: string | null
  badge_color?: string | null
  image_url?: string | null
  image_url_mobile?: string | null
  blurhash?: string | null
  blurhash_mobile?: string | null
  href?: string
  // Legacy category-derived fields (fallback path)
  name?: string
  slug?: string
  hero_image_mobile?: string | null
  hero_image_desktop?: string | null
}

// Legacy per-category copy — used only when a slide has no DB-provided badge/subtitle.
const LEGACY_COPY: Record<string, { badge: string; badgeColor: string; subtitle: string }> = {
  fasteners: {
    badge: 'New Arrivals',
    badgeColor: 'bg-primary-500',
    subtitle: 'Bolts, nuts, screws & more — precision engineered for industrial use',
  },
  'power-transmission': {
    badge: 'Top Picks',
    badgeColor: 'bg-red-500',
    subtitle: 'V-belts, timing belts, bearings and transmission components',
  },
  'tools-equipment': {
    badge: 'Best Sellers',
    badgeColor: 'bg-accent-500',
    subtitle: 'Drill bits, cutting tools and accessories for every job',
  },
  'welding-supplies': {
    badge: 'Trusted Quality',
    badgeColor: 'bg-emerald-600',
    subtitle: 'Welding rods, electrodes and accessories for every application',
  },
  'electrical-cables': {
    badge: 'In Stock',
    badgeColor: 'bg-blue-600',
    subtitle: 'Industrial cables, wires and electrical accessories',
  },
  'industrial-components': {
    badge: 'Precision Parts',
    badgeColor: 'bg-purple-600',
    subtitle: 'Gears, flanges, bearings and machined components',
  },
  'material-handling': {
    badge: 'Heavy Duty',
    badgeColor: 'bg-orange-600',
    subtitle: 'Chains, hooks, pulleys and lifting equipment',
  },
  abrasives: {
    badge: 'Top Picks',
    badgeColor: 'bg-yellow-600',
    subtitle: 'Grinding wheels, cutting discs and abrasive products',
  },
  'lubricants-chemicals': {
    badge: 'In Stock',
    badgeColor: 'bg-teal-600',
    subtitle: 'Industrial lubricants, greases and specialty chemicals',
  },
  'safety-equipment': {
    badge: 'Stay Safe',
    badgeColor: 'bg-rose-600',
    subtitle: 'PPE, helmets, gloves and workplace safety gear',
  },
}

const PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1440" height="640"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'
const AUTO_ADVANCE_MS = 5000
const EDGE_MASK =
  '[-webkit-mask-image:linear-gradient(to_right,transparent_0%,#000_35%)] [mask-image:linear-gradient(to_right,transparent_0%,#000_35%)]'

interface Props {
  slides: HeroSlide[]
}

interface Resolved {
  key: string
  href: string
  title: string
  subtitle: string
  badge: string
  badgeColor: string
  mobileImg: string
  desktopImg: string
  blurhash: string | null
}

function resolveSlide(s: HeroSlide, i: number): Resolved {
  const legacy = s.slug ? LEGACY_COPY[s.slug] : undefined
  const title = s.title ?? s.name ?? 'Shop Now'
  const badge = s.badge_text ?? legacy?.badge ?? 'Shop Now'
  const badgeColor = s.badge_color ?? legacy?.badgeColor ?? 'bg-primary-500'
  const subtitle = s.subtitle ?? legacy?.subtitle ?? ''
  const href = s.href ?? (s.slug ? `/categories/${s.slug}` : '/products')
  const mobileImg = s.image_url_mobile ?? s.image_url ?? s.hero_image_mobile ?? PLACEHOLDER
  const desktopImg = s.image_url ?? s.image_url_mobile ?? s.hero_image_desktop ?? s.hero_image_mobile ?? PLACEHOLDER
  // Mirrors the desktop image's fallback chain: the canvas sits under the <picture>, whose
  // default <img> is the mobile source, so prefer whichever hash matches what renders first.
  const blurhash = s.blurhash_mobile || s.blurhash || null
  return { key: s.id ?? s.slug ?? String(i), href, title, subtitle, badge, badgeColor, mobileImg, desktopImg, blurhash }
}

export default function HeroCarousel({ slides }: Props) {
  if (!slides.length) return null

  return (
    <div className="bg-surface px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6 h-[clamp(20rem,60svh,32rem)] sm:h-[clamp(22rem,58svh,34rem)] lg:h-[clamp(24rem,56svh,38rem)]">
      <Slides
        layout="fade"
        ariaLabel="Featured"
        autoplay={AUTO_ADVANCE_MS}
        className="relative w-full rounded-2xl overflow-hidden shadow-2xl h-full select-none"
      >
        {slides.map((raw, i) => {
          const s = resolveSlide(raw, i)
          return (
            <Fragment key={s.key}>
              <Link href={s.href} className="absolute inset-0 z-10" aria-label={`Shop ${s.title}`} />

              {/* The image covers only the right ~60%, and the gradient below it is not fully
                  opaque everywhere. Without a solid base the near-white page background
                  (--color-surface #F9FAFB) bled through on the left as a grey haze, and the
                  boundary where that met the image read as a faint vertical line. */}
              <div className="absolute inset-0 bg-[#0d0d0d]">
                {/* Fade the image's left edge into the base instead of cutting it off. */}
                <SlideImage
                  src={s.desktopImg}
                  mobileSrc={s.mobileImg}
                  blurhash={s.blurhash}
                  breakpoint={1024}
                  blurClassName={`absolute right-0 top-0 h-full w-[62%] sm:w-[60%] ${EDGE_MASK}`}
                  className={`absolute right-0 top-0 h-full w-[62%] sm:w-[60%] object-cover object-center ${EDGE_MASK}`}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-35% via-[#0d0d0d]/80 via-60% to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
              </div>

              <div className="relative z-10 h-full flex flex-col justify-start pt-10 sm:pt-12 md:pt-14 px-6 sm:px-12 md:px-16 pb-16 max-w-[55%] sm:max-w-[50%] pointer-events-none">
                {s.badge && (
                  <span
                    className={`inline-block self-start ${s.badgeColor} text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded mb-4 sm:mb-5`}
                  >
                    {s.badge}
                  </span>
                )}
                <h1 className="font-black text-white leading-[0.9] tracking-tight whitespace-pre-line mb-3 sm:mb-4 text-[clamp(2rem,5vw,4rem)]">
                  {s.title.replace(' ', '\n')}
                </h1>
                {s.subtitle && (
                  <p className="text-white/50 text-xs sm:text-sm leading-relaxed max-w-[180px] sm:max-w-[260px]">
                    {s.subtitle}
                  </p>
                )}
              </div>
            </Fragment>
          )
        })}
      </Slides>
    </div>
  )
}
