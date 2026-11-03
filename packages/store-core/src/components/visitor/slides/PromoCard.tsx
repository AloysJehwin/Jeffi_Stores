import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import StoreMedia from '@/components/visitor/media/StoreMedia'

/** The backdrop image classes, hover zoom included. */
export const CARD_IMAGE =
  'absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.04]'
export const BANNER_IMAGE =
  'absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.03]'

/** A full-width banner in the admin's shape (with the `shape-box` class): a tall one narrows, centred, rather than fill the screen. */
export const bannerShape = (aspectRatio: number): CSSProperties => ({
  aspectRatio,
  maxWidth: `calc(min(80vh, 640px) * ${aspectRatio})`,
  marginInline: 'auto',
})

export interface PromoMediaProps {
  /** A 4:5 / 1:1 card takes the card clip, a wide slot the wide one; each falls back to the other. */
  card: boolean
  video?: string | null
  videoCard?: string | null
  /** The picture the slot draws, which is the clip's poster. */
  poster?: string | null
  alt?: string
  /** Plays only while true, e.g. the current slide. */
  active: boolean
  /** The clip's classes: the image's, so it fills the same box. */
  className: string
  /** The slot's picture (SlideImage). */
  children: ReactNode
}

/** A promo backdrop: the slot's picture with its clip, picked as the picture is, over it. */
export function PromoMedia({ card, video, videoCard, poster, children, ...p }: PromoMediaProps) {
  return (
    <StoreMedia {...p} image={poster} video={card ? videoCard || video : video || videoCard}>
      {children}
    </StoreMedia>
  )
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'
const FOCUS_INSIDE =
  'has-[>a:focus-visible]:ring-2 has-[>a:focus-visible]:ring-primary-500 has-[>a:focus-visible]:ring-offset-2'

export interface PromoFaceProps {
  /** None (the admin preview, a slide without a link) draws a plain block. */
  href: string | null
  /** The link's accessible name. */
  label: string
  tabIndex?: number
  /** Image layers under the scrim; without one the text sits on `surface`. */
  backdrop?: ReactNode
  /** The background class behind the backdrop. */
  surface?: string
  badge?: string | null
  /** A `bg-*` class for the badge; primary when unset. */
  badgeClass?: string | null
  eyebrow?: string | null
  title: ReactNode
  sub?: string | null
  ctaLabel?: string | null
  /** Under the subtitle, e.g. a price. */
  footer?: ReactNode
  /** A control on the face (quick add). A button can't sit in a link, so the link becomes a layer under it. */
  action?: ReactNode
}

function Face({
  href,
  label,
  tabIndex,
  action,
  className,
  children,
}: Pick<PromoFaceProps, 'href' | 'label' | 'tabIndex' | 'action'> & { className: string; children: ReactNode }) {
  if (href && !action)
    return (
      <Link href={href} aria-label={label} tabIndex={tabIndex} className={`${className} ${FOCUS}`}>
        {children}
      </Link>
    )
  return (
    <div className={`relative ${className} ${href ? FOCUS_INSIDE : ''}`}>
      {href && (
        <Link
          href={href}
          aria-label={label}
          tabIndex={tabIndex}
          className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none"
        />
      )}
      {children}
    </div>
  )
}

const CtaPill = ({ label, className }: { label: string; className: string }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-gray-900 shadow-sm sm:text-sm ${className}`}
  >
    {label}
    <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
  </span>
)

// A card that fills its slide: bottom scrim, badge pill, title, subtitle, CTA pill, hover lift.
export function PromoCard({ surface = 'bg-[#0d0d0d]', ...p }: PromoFaceProps) {
  return (
    <Face
      href={p.href}
      label={p.label}
      tabIndex={p.tabIndex}
      action={p.action}
      className={`group relative block h-full w-full overflow-hidden rounded-2xl ${surface} shadow-md transition-[transform,box-shadow] duration-300 ease-out hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none`}
    >
      {p.backdrop}
      {p.backdrop && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 via-45% to-transparent" />
      )}

      <div className="shape-short-tight absolute inset-x-0 bottom-0 flex flex-col items-start p-5 md:p-6">
        {p.badge && (
          <span
            className={`shape-tiny-hide mb-3 text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-full ${p.badgeClass || 'bg-primary-500'}`}
          >
            {p.badge}
          </span>
        )}
        {p.eyebrow && (
          <p className="shape-short-hide mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/70">{p.eyebrow}</p>
        )}
        <h3 className="shape-short-title line-clamp-3 text-[clamp(1.25rem,1rem+1vw,1.75rem)] font-black leading-[1.1] tracking-tight text-white">
          {p.title}
        </h3>
        {p.sub && <p className="shape-short-hide mt-1.5 line-clamp-2 text-sm leading-snug text-white/75">{p.sub}</p>}
        {p.footer}
        {p.ctaLabel && <CtaPill label={p.ctaLabel} className="shape-shorter-hide mt-4" />}
      </div>
      {p.action && <div className="absolute bottom-5 right-5 z-20 md:bottom-6 md:right-6">{p.action}</div>}
    </Face>
  )
}

const BANNER_H = 'h-[clamp(14rem,40vw,28rem)]'

// One slide across the row, like the hero and business cards.
export function PromoBanner({
  surface = 'bg-[#0d0d0d]',
  aspectRatio,
  ...p
}: PromoFaceProps & { aspectRatio?: number | null }) {
  return (
    <Face href={p.href} label={p.label} tabIndex={p.tabIndex} action={p.action} className="group block rounded-2xl">
      <div
        className={`relative w-full overflow-hidden rounded-2xl ${surface} ${aspectRatio ? 'shape-box' : BANNER_H} shadow-2xl`}
        style={aspectRatio ? bannerShape(aspectRatio) : undefined}
      >
        {p.backdrop}
        {p.backdrop && (
          <>
            <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/30 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </>
        )}

        <div className="shape-short-tight absolute inset-x-0 bottom-0 pointer-events-none p-6 sm:p-10 lg:p-14">
          {p.badge && (
            <span
              className={`shape-tiny-hide inline-block text-white text-[10px] sm:text-xs font-black uppercase tracking-[0.15em] px-3 py-1.5 rounded-full mb-3 ${p.badgeClass || 'bg-primary-500'}`}
            >
              {p.badge}
            </span>
          )}
          {p.eyebrow && (
            <p className="shape-short-hide mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-white/70 sm:text-xs">
              {p.eyebrow}
            </p>
          )}
          <h3 className="shape-short-title max-w-2xl font-black text-white leading-[1.05] tracking-tight text-[clamp(1.75rem,4.4vw,3.75rem)]">
            {p.title}
          </h3>
          {p.sub && <p className="shape-short-hide mt-2 max-w-md leading-relaxed text-white/80 text-sm sm:text-base">{p.sub}</p>}
          {p.footer}
          {p.ctaLabel && <CtaPill label={p.ctaLabel} className="shape-shorter-hide mt-4 sm:px-5 sm:py-2.5" />}
        </div>
        {p.action && (
          <div className="absolute bottom-6 right-6 z-20 sm:bottom-10 sm:right-10 lg:bottom-14 lg:right-14">
            {p.action}
          </div>
        )}
      </div>
    </Face>
  )
}

/** The eyebrow and title over a slides section. */
export function PromoHeading({ eyebrow, title }: { eyebrow?: string | null; title?: string | null }) {
  if (!eyebrow && !title) return null
  return (
    <div className="mb-5 md:mb-7 px-1">
      {eyebrow && <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow}</p>}
      {title && <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title}</h2>}
    </div>
  )
}
