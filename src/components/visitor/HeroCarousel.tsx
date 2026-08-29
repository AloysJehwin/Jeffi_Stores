'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

export interface HeroSlide {
  // New DB-backed shape
  id?: string
  title?: string
  subtitle?: string | null
  badge_text?: string | null
  badge_color?: string | null
  image_url?: string | null
  image_url_mobile?: string | null
  href?: string
  // Legacy category-derived fields (fallback path)
  name?: string
  slug?: string
  hero_image_mobile?: string | null
  hero_image_desktop?: string | null
}

// Legacy per-category copy — used only when a slide has no DB-provided badge/subtitle.
const LEGACY_COPY: Record<string, { badge: string; badgeColor: string; subtitle: string }> = {
  'fasteners':              { badge: 'New Arrivals',    badgeColor: 'bg-primary-500',  subtitle: 'Bolts, nuts, screws & more — precision engineered for industrial use' },
  'power-transmission':     { badge: 'Top Picks',       badgeColor: 'bg-red-500',      subtitle: 'V-belts, timing belts, bearings and transmission components' },
  'tools-equipment':        { badge: 'Best Sellers',    badgeColor: 'bg-accent-500',   subtitle: 'Drill bits, cutting tools and accessories for every job' },
  'welding-supplies':       { badge: 'Trusted Quality', badgeColor: 'bg-emerald-600',  subtitle: 'Welding rods, electrodes and accessories for every application' },
  'electrical-cables':      { badge: 'In Stock',        badgeColor: 'bg-blue-600',     subtitle: 'Industrial cables, wires and electrical accessories' },
  'industrial-components':  { badge: 'Precision Parts', badgeColor: 'bg-purple-600',   subtitle: 'Gears, flanges, bearings and machined components' },
  'material-handling':      { badge: 'Heavy Duty',      badgeColor: 'bg-orange-600',   subtitle: 'Chains, hooks, pulleys and lifting equipment' },
  'abrasives':              { badge: 'Top Picks',       badgeColor: 'bg-yellow-600',   subtitle: 'Grinding wheels, cutting discs and abrasive products' },
  'lubricants-chemicals':   { badge: 'In Stock',        badgeColor: 'bg-teal-600',     subtitle: 'Industrial lubricants, greases and specialty chemicals' },
  'safety-equipment':       { badge: 'Stay Safe',       badgeColor: 'bg-rose-600',     subtitle: 'PPE, helmets, gloves and workplace safety gear' },
}

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1440" height="640"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'
const AUTO_ADVANCE_MS = 5000
const SWIPE_THRESHOLD = 50 // px

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
  return { key: s.id ?? s.slug ?? String(i), href, title, subtitle, badge, badgeColor, mobileImg, desktopImg }
}

export default function HeroCarousel({ slides }: Props) {
  const [active, setActive] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const touchDeltaX = useRef(0)
  const [dragging, setDragging] = useState(false)
  const paused = useRef(false)

  const count = slides.length
  const go = useCallback((next: number) => setActive(((next % count) + count) % count), [count])

  useEffect(() => {
    if (count <= 1) return
    const t = setTimeout(() => { if (!paused.current) go(active + 1) }, AUTO_ADVANCE_MS)
    return () => clearTimeout(t)
  }, [active, go, count])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    paused.current = true
    setDragging(true)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
  }
  const onTouchEnd = () => {
    const dx = touchDeltaX.current
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      go(active + (dx < 0 ? 1 : -1)) // swipe left → next
    }
    touchStartX.current = null
    touchDeltaX.current = 0
    paused.current = false
    setDragging(false)
  }

  if (!count) return null

  return (
    <div className="bg-surface px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6 h-[clamp(20rem,60svh,32rem)] sm:h-[clamp(22rem,58svh,34rem)] lg:h-[clamp(24rem,56svh,38rem)]">
      <div
        className="relative w-full rounded-2xl overflow-hidden shadow-2xl h-full select-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {slides.map((raw, i) => {
          const s = resolveSlide(raw, i)
          return (
            <div
              key={s.key}
              className={`absolute inset-0 transition-opacity duration-700 ${i === active ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
            >
              <Link href={s.href} className="absolute inset-0 z-10" aria-label={`Shop ${s.title}`}
                onClick={(e) => { if (dragging && Math.abs(touchDeltaX.current) > SWIPE_THRESHOLD) e.preventDefault() }} />

              {/* The image covers only the right ~60%, and the gradient below it is not fully
                  opaque everywhere. Without a solid base the near-white page background
                  (--color-surface #F9FAFB) bled through on the left as a grey haze, and the
                  boundary where that met the image read as a faint vertical line. */}
              <div className="absolute inset-0 bg-[#0d0d0d]">
                <picture>
                  <source media="(min-width: 1024px)" srcSet={s.desktopImg} />
                  {/* Fade the image's left edge into the base instead of cutting it off. */}
                  <img
                    src={s.mobileImg}
                    alt=""
                    className="absolute right-0 top-0 h-full w-[62%] sm:w-[60%] object-cover object-center
                               [-webkit-mask-image:linear-gradient(to_right,transparent_0%,#000_35%)]
                               [mask-image:linear-gradient(to_right,transparent_0%,#000_35%)]"
                  />
                </picture>
                <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-35% via-[#0d0d0d]/80 via-60% to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
              </div>

              <div className="relative z-10 h-full flex flex-col justify-start pt-10 sm:pt-12 md:pt-14 px-6 sm:px-12 md:px-16 pb-16 max-w-[55%] sm:max-w-[50%] pointer-events-none">
                {s.badge && (
                  <span className={`inline-block self-start ${s.badgeColor} text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded mb-4 sm:mb-5`}>
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
            </div>
          )
        })}

        {/* Dot indicators */}
        {count > 1 && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                className={`rounded-full transition-all duration-300 ${i === active ? 'bg-white w-5 h-2' : 'bg-white/35 hover:bg-white/60 w-2 h-2'}`}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
