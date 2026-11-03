import type { CSSProperties, ReactNode } from 'react'
import { optimizedUrl } from '@/lib/shared/image-url'
import type { SectionSides } from '@/lib/catalog/homepage-sections'

const SHADOW = 'radial-gradient(ellipse 50% 50% at 50% 50%, rgb(0 0 0 / 0.42) 45%, rgb(0 0 0 / 0.14) 75%, transparent)'
// Strongest beside the banner, gone by the row's edges and above and below it.
const FADE = 'radial-gradient(ellipse 50% 50% at 50% 50%, #000 55%, transparent)'
// The neighbour cards fade towards the row's edges.
const PEEK_FADE = { prev: 'linear-gradient(to left, #000 25%, transparent)', next: 'linear-gradient(to right, #000 25%, transparent)' }
const PEEK =
  'absolute inset-y-[8%] w-[calc(var(--banner-w)*0.9)] overflow-hidden rounded-2xl bg-gray-900 bg-cover bg-center opacity-50 transition-opacity hover:opacity-75 focus-visible:opacity-75 focus-visible:outline-none'

export interface PeekSlide {
  image: string | null | undefined
  label: string
  onSelect: () => void
}

/**
 * The row behind a banner (bannerShape) that a tall shape narrows: a soft shadow, its picture blurred,
 * or the previous and next slides as faded cards, in the space left and right. Under a full-width
 * banner it stays covered.
 */
export default function BannerSides({
  sides,
  image,
  aspect,
  prev,
  next,
  children,
}: {
  sides: SectionSides
  /** The banner's current picture, for the glow. */
  image?: string | null
  /** The banner's shape, to place the neighbour cards beside it. */
  aspect?: number | null
  prev?: PeekSlide
  next?: PeekSlide
  children: ReactNode
}) {
  const peek = sides === 'peek' && aspect && prev && next
  if (sides === 'plain' || (sides === 'glow' && !image) || (sides === 'peek' && !peek)) return <>{children}</>
  return (
    <div className="relative">
      {sides === 'shadow' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: SHADOW }} />
      )}
      {sides === 'glow' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ maskImage: FADE, WebkitMaskImage: FADE }}
        >
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-90 blur-2xl saturate-150 transition-[background-image] duration-700 dark:opacity-60"
            style={{ backgroundImage: `url("${optimizedUrl(image!, 64)}")` }}
          />
        </div>
      )}
      {peek && (
        // Same width formula as bannerShape, so each card sits a gap outside the banner's edge.
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ '--banner-w': `min(100%, calc(min(80vh, 640px) * ${aspect}))` } as CSSProperties}
        >
          {(['prev', 'next'] as const).map(side => {
            const s = side === 'prev' ? prev : next
            return (
              <button
                key={side}
                type="button"
                aria-label={s.label}
                onClick={s.onSelect}
                className={PEEK}
                style={{
                  [side === 'prev' ? 'right' : 'left']: 'calc(50% + var(--banner-w) / 2 + 1rem)',
                  backgroundImage: s.image ? `url("${optimizedUrl(s.image, 828)}")` : undefined,
                  maskImage: PEEK_FADE[side],
                  WebkitMaskImage: PEEK_FADE[side],
                }}
              />
            )
          })}
        </div>
      )}
      {children}
    </div>
  )
}
