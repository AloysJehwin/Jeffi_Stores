'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface HeroSlide {
  name: string
  slug: string
  hero_image_mobile: string | null
  hero_image_desktop: string | null
}

// Per-category copy — badge + subtitle
const COPY: Record<string, { badge: string; badgeColor: string; subtitle: string }> = {
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

// Fallback placeholder when no hero image has been generated yet
const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1440" height="640"%3E%3Crect width="100%25" height="100%25" fill="%230d0d0d"/%3E%3C/svg%3E'

const AUTO_ADVANCE_MS = 5000

interface Props {
  slides: HeroSlide[]
}

export default function HeroCarousel({ slides }: Props) {
  const [active, setActive] = useState(0)
  const go = useCallback((next: number) => setActive(next), [])

  useEffect(() => {
    const t = setTimeout(() => go((active + 1) % slides.length), AUTO_ADVANCE_MS)
    return () => clearTimeout(t)
  }, [active, go, slides.length])

  if (!slides.length) return null

  return (
    <div className="bg-surface px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6 h-[calc(100svh-4rem-392px)] sm:h-[calc(100svh-4rem-360px)] lg:h-[calc(100svh-5rem-300px)]">
      <div className="relative w-full rounded-2xl overflow-hidden shadow-2xl h-full">
        {slides.map((s, i) => {
          const copy = COPY[s.slug] ?? { badge: 'Shop Now', badgeColor: 'bg-primary-500', subtitle: '' }
          const mobileImg  = s.hero_image_mobile  ?? PLACEHOLDER
          const desktopImg = s.hero_image_desktop ?? s.hero_image_mobile ?? PLACEHOLDER

          return (
            <div
              key={s.slug}
              className={`absolute inset-0 transition-opacity duration-700 ${i === active ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
            >
              <Link href={`/categories/${s.slug}`} className="absolute inset-0 z-10" aria-label={`Shop ${s.name}`} />

              {/* Responsive background image */}
              <div className="absolute inset-0">
                <picture>
                  <source media="(min-width: 1024px)" srcSet={desktopImg} />
                  <img
                    src={mobileImg}
                    alt=""
                    className="absolute right-0 top-0 h-full w-[70%] sm:w-[65%] object-cover object-center"
                  />
                </picture>
                <div className="absolute inset-0 bg-gradient-to-r from-[#0d0d0d] from-35% via-[#0d0d0d]/80 via-60% to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30" />
              </div>

              {/* Text — top left */}
              <div className="relative z-10 h-full flex flex-col justify-start pt-10 sm:pt-12 md:pt-14 px-6 sm:px-12 md:px-16 pb-16 max-w-[58%] sm:max-w-[52%] pointer-events-none">
                <span className={`inline-block self-start ${copy.badgeColor} text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded mb-4 sm:mb-5`}>
                  {copy.badge}
                </span>
                <h1 className="font-black text-white leading-[0.9] tracking-tight whitespace-pre-line mb-3 sm:mb-4 text-[clamp(2rem,5vw,4rem)]">
                  {s.name.replace(' ', '\n')}
                </h1>
                <p className="text-white/50 text-xs sm:text-sm leading-relaxed max-w-[180px] sm:max-w-[260px]">
                  {copy.subtitle}
                </p>
              </div>
            </div>
          )
        })}

        {/* Dot indicators */}
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
      </div>
    </div>
  )
}
