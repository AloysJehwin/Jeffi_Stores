'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import Slides, { useSlide, type SlidesProps } from '@/components/visitor/slides/Slides'
import SlideImage from '@/components/visitor/slides/SlideImage'
import {
  BANNER_IMAGE,
  CARD_IMAGE,
  PromoBanner,
  PromoCard,
  PromoHeading,
  type PromoFaceProps,
} from '@/components/visitor/slides/PromoCard'
import { KEN_BURNS, RevealWords, headlineVariants, usePointerParallax } from '@/components/visitor/slides/slide-motion'
import QuickAddButton from '@/components/visitor/QuickAddButton'
import { formatINR } from '@/lib/shared/format'
import type { SlideCard, SlidesAspect, SlidesData, SlidesLayout } from '@/lib/catalog/homepage-sections'

const ASPECT_CLASS: Record<SlidesAspect, string> = {
  '4:5': 'aspect-[4/5]',
  '1:1': 'aspect-square',
  '16:9': 'aspect-video',
}
// Fade stacks its slides, so the stage sets their size: a portrait or square card centred, a wide one larger.
const FADE_WIDTH: Record<SlidesAspect, string> = { '4:5': 'max-w-sm', '1:1': 'max-w-md', '16:9': 'max-w-5xl' }
const WIDE_CARD = '[--slide-w:86vw] sm:[--slide-w:64%] lg:[--slide-w:48%]'
const WIDE_RAIL = 'w-[80%] sm:w-[45%] lg:w-[30%]'
const DOTS = { className: 'mt-3 justify-center' }

// Packshots sit whole on the card instead of being cropped to it.
const CARD_PRODUCT =
  'absolute inset-0 h-full w-full object-contain p-[10%] transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.04]'
const BANNER_PRODUCT =
  'absolute inset-0 h-full w-full object-contain object-right p-6 sm:p-10 transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.03]'
const NO_IMAGE = 'bg-gradient-to-br from-primary-600 to-accent-600'
const PARALLAX = { x: 10, y: 8 }
const PARALLAX_ZOOM = 1.1

type LayoutProps = Partial<
  Pick<
    SlidesProps,
    'aspect' | 'cardWidth' | 'dots' | 'arrows' | 'className' | 'slideClassName' | 'itemClassName' | 'trackClassName'
  >
>

function layoutProps(layout: SlidesLayout, aspect: SlidesAspect, count: number): LayoutProps {
  switch (layout) {
    case 'cards':
      return { aspect, cardWidth: aspect === '16:9' ? WIDE_CARD : undefined, dots: DOTS }
    case 'rail':
      return {
        slideClassName: ASPECT_CLASS[aspect],
        itemClassName: aspect === '16:9' ? WIDE_RAIL : undefined,
        trackClassName: 'gap-3 md:gap-5 py-2',
      }
    case 'fade':
      return {
        className: `relative mx-auto w-full ${FADE_WIDTH[aspect]} ${ASPECT_CLASS[aspect]} ${count > 1 ? 'mb-9' : ''}`,
        arrows: true,
        dots: { tone: 'brand', className: 'absolute -bottom-7 left-1/2 -translate-x-1/2 z-30' },
      }
    default:
      return { dots: DOTS }
  }
}

export interface SlidesSectionProps {
  data: SlidesData
  eyebrow?: string | null
  title?: string | null
  /** The admin preview: no links, and no quick add (there is no cart there). */
  preview?: boolean
}

export default function SlidesSection({ data, eyebrow, title, preview = false }: SlidesSectionProps) {
  const { layout, aspect, slides } = data
  if (slides.length === 0) return null

  return (
    <section className="bg-surface px-3 sm:px-6 md:px-8 py-6 md:py-8">
      <PromoHeading eyebrow={eyebrow} title={title} />
      <Slides
        layout={layout}
        ariaLabel={title ?? 'Slides'}
        autoplay={data.autoplay ? data.intervalSeconds * 1000 : false}
        {...layoutProps(layout, aspect, slides.length)}
      >
        {slides.map(s => (
          <Slide
            key={s.id}
            slide={s}
            layout={layout}
            aspect={aspect}
            seconds={data.intervalSeconds}
            preview={preview}
          />
        ))}
      </Slides>
    </section>
  )
}

interface SlideProps {
  slide: SlideCard
  layout: SlidesLayout
  aspect: SlidesAspect
  seconds: number
  preview: boolean
}

function Slide({ slide, layout, aspect, seconds, preview }: SlideProps) {
  const { current, clone } = useSlide()
  const reduced = !!useReducedMotion()
  const wide = layout === 'banner'
  const rail = layout === 'rail'
  // A rail shows several slides at once, so none waits to be current.
  const live = rail || current
  const effect = slide.kind === 'custom' && !reduced ? slide.motion : 'none'
  const product = slide.kind === 'product' ? slide.product : undefined

  const portrait = !wide && aspect !== '16:9'
  const src = portrait ? (slide.imageCard ?? slide.image) : (slide.image ?? slide.imageCard)
  const hash = portrait ? (slide.blurhashCard ?? slide.blurhash) : (slide.blurhash ?? slide.blurhashCard)
  const image = src ? (
    <SlideImage
      card
      cardSrc={src}
      blurhashCard={hash}
      alt={slide.title}
      loading={current ? 'eager' : 'lazy'}
      className={product ? (wide ? BANNER_PRODUCT : CARD_PRODUCT) : wide ? BANNER_IMAGE : CARD_IMAGE}
    />
  ) : null

  const backdrop =
    image && effect === 'kenburns' ? (
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1 }}
        animate={{ scale: live ? 1 + KEN_BURNS : 1 }}
        transition={live ? { duration: seconds, ease: 'linear' } : { duration: 0.6, ease: 'easeOut' }}
      >
        {image}
      </motion.div>
    ) : (
      image
    )

  const title =
    effect === 'reveal' ? (
      <motion.span
        className="block"
        variants={headlineVariants(reduced)}
        initial="hidden"
        {...(rail ? { whileInView: 'show', viewport: { once: true } } : { animate: current ? 'show' : 'hidden' })}
      >
        <RevealWords text={slide.title} reduced={reduced} />
      </motion.span>
    ) : (
      slide.title
    )

  const price = product && slide.price != null ? slide.price : null
  const mrp = price != null && slide.mrp != null && slide.mrp > price ? slide.mrp : null
  const from = product?.hasVariants ? 'From ' : ''

  const face: Omit<PromoFaceProps, 'backdrop'> = {
    href: preview ? null : slide.href,
    label: [slide.title, slide.badge, slide.sub, price != null && `${from}${formatINR(price)}`]
      .filter(Boolean)
      .join(', '),
    tabIndex: clone ? -1 : undefined,
    surface: !image ? NO_IMAGE : product ? 'bg-surface-elevated' : undefined,
    badge: slide.badge,
    badgeClass: slide.badgeClass,
    eyebrow: slide.eyebrow,
    title,
    sub: slide.sub,
    ctaLabel: slide.ctaLabel,
    footer: price != null && (
      <p className={`flex flex-wrap items-baseline gap-x-2 text-white ${wide ? 'mt-3' : 'mt-2 pr-10'}`}>
        <span className={`font-black ${wide ? 'text-xl sm:text-2xl' : 'text-lg'}`}>
          {from}
          {formatINR(price)}
        </span>
        {mrp != null && <span className="text-sm text-white/60 line-through">{formatINR(mrp)}</span>}
      </p>
    ),
    action: product && !preview && (
      <QuickAddButton
        productId={product.id}
        productName={product.name}
        slug={product.slug}
        hasVariants={product.hasVariants}
        inStock={product.isDigital || product.effectiveStock > 0}
        imageUrl={product.primaryImage?.thumbnail_url || product.primaryImage?.image_url || null}
        brandName={product.brandName}
        categoryName={product.categoryName}
        displayPrice={product.displayPrice}
        mrp={product.mrp}
        discountPct={product.discountPct > 0 ? product.discountPct : product.mrpDiscount}
        isDigital={product.isDigital}
      />
    ),
  }
  const draw = (b: ReactNode) => (wide ? <PromoBanner {...face} backdrop={b} /> : <PromoCard {...face} backdrop={b} />)

  if (image && effect === 'parallax') return <Parallax image={image} draw={draw} />
  return draw(backdrop)
}

// The image drifts with the mouse; it is zoomed a little so its edges never show.
function Parallax({ image, draw }: { image: ReactNode; draw: (backdrop: ReactNode) => ReactNode }) {
  const p = usePointerParallax(false, PARALLAX)
  return (
    <div className="h-full w-full" onPointerMove={p.onPointerMove} onPointerLeave={p.onPointerLeave}>
      {draw(
        <motion.div className="absolute inset-0" style={{ x: p.x, y: p.y, scale: PARALLAX_ZOOM }}>
          {image}
        </motion.div>
      )}
    </div>
  )
}
