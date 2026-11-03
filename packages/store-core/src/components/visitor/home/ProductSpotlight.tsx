'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Package } from 'lucide-react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import StoreImage from '@/components/visitor/StoreImage'
import QuickAddButton from '@/components/visitor/QuickAddButton'
import { SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'
import type { CardProps } from '@/lib/catalog/product-card-props'

const COPY = SECTION_COPY_DEFAULTS.product_spotlight

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Points (0–1 across the pinned scroll) where each part settles on desktop.
const IMAGE_SETTLES = 0.3
const CALLOUT_START = 0.3
const CALLOUT_STEP = 0.12
const REVEAL_SPAN = 0.1

interface ProductSpotlightProps {
  product: CardProps
  headline: string | null
  callouts: string[]
  eyebrow?: string | null
  ctaLabel?: string | null
}

export default function ProductSpotlight({ product, headline, callouts, eyebrow, ctaLabel }: ProductSpotlightProps) {
  const ref = useRef<HTMLElement>(null)
  const reduced = !!useReducedMotion()
  // Phones get a plain stacked card: a sticky viewport is unreadable on a short screen.
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const sync = () => setDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  const driven = desktop && !reduced

  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const scale = useTransform(scrollYProgress, [0, IMAGE_SETTLES], [0.85, 1])
  const rotate = useTransform(scrollYProgress, [0, IMAGE_SETTLES], [-6, 0])
  const [signal, setSignal] = useState(0)

  const href = `/products/${product.slug}`
  const image = product.primaryImage
  const inStock = product.isDigital || product.effectiveStock > 0
  const mrp = product.mrp != null && product.mrp > product.displayPrice ? product.mrp : null
  const label = ctaLabel ?? COPY.ctaLabel
  const ctaAt = CALLOUT_START + callouts.length * CALLOUT_STEP

  return (
    <section ref={ref} className="relative bg-surface-secondary md:min-h-[220vh]">
      <div className="md:sticky md:top-0 md:flex md:h-screen md:items-center">
        <div className="container mx-auto px-4 py-12 md:py-0">
          <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
            <motion.div style={driven ? { scale, rotate } : undefined} className="mx-auto w-full max-w-md md:max-w-none">
              <Link
                href={href}
                className="relative block aspect-square overflow-hidden rounded-[2rem] border border-border-default bg-surface-elevated shadow-xl"
              >
                {image ? (
                  <StoreImage
                    src={image.image_url}
                    alt={product.name}
                    blurhash={image.blurhash}
                    sizes="(min-width: 768px) 45vw, 90vw"
                    className="h-full w-full object-contain p-8 md:p-12"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Package className="h-16 w-16 text-foreground-muted" aria-hidden="true" />
                  </div>
                )}
                {product.mrpDiscount > 0 && (
                  <span className="absolute left-4 top-4 rounded-full bg-accent-500 px-3 py-1 text-sm font-bold text-white dark:bg-accent-600">
                    {product.mrpDiscount}% off
                  </span>
                )}
              </Link>
            </motion.div>

            <div className="flex flex-col items-start gap-4 md:gap-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-500">{eyebrow ?? COPY.eyebrow}</p>
              <h2 className="text-3xl font-black leading-[1.05] tracking-tight text-foreground md:text-5xl">
                {headline ?? product.name}
              </h2>
              {headline && (
                <Link href={href} className="text-base font-semibold text-foreground-secondary transition-colors hover:text-accent-600">
                  {product.name}
                </Link>
              )}
              {product.brandName && (
                <p className="text-xs font-medium uppercase tracking-wide text-accent-600 dark:text-accent-400">{product.brandName}</p>
              )}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-3xl font-black text-primary-600 dark:text-primary-400 md:text-4xl">
                  {product.hasVariants ? 'From ' : ''}&#x20B9;{inr(product.displayPrice)}
                </span>
                {mrp != null && (
                  <>
                    <span className="text-base text-foreground-muted line-through">&#x20B9;{inr(mrp)}</span>
                    <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-xs font-bold text-accent-600 dark:text-accent-400">
                      {product.mrpDiscount}% off
                    </span>
                  </>
                )}
              </div>

              {callouts.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {callouts.map((text, i) => (
                    <li key={i}>
                      <ScrollIn
                        at={CALLOUT_START + i * CALLOUT_STEP}
                        order={i}
                        progress={scrollYProgress}
                        driven={driven}
                        reduced={reduced}
                        className="flex items-start gap-3 text-base text-foreground-secondary md:text-lg"
                      >
                        <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-accent-600 dark:text-accent-400">
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                        </span>
                        <span>{text}</span>
                      </ScrollIn>
                    </li>
                  ))}
                </ul>
              )}

              <ScrollIn
                at={ctaAt}
                order={callouts.length}
                progress={scrollYProgress}
                driven={driven}
                reduced={reduced}
                className="mt-2 flex flex-wrap items-center gap-3"
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-elevated py-1.5 pl-1.5 pr-4 shadow-sm">
                  <QuickAddButton
                    productId={product.id}
                    productName={product.name}
                    slug={product.slug}
                    hasVariants={product.hasVariants}
                    inStock={inStock}
                    imageUrl={image?.thumbnail_url || image?.image_url || null}
                    brandName={product.brandName}
                    categoryName={product.categoryName}
                    displayPrice={product.displayPrice}
                    mrp={product.mrp}
                    discountPct={product.discountPct > 0 ? product.discountPct : product.mrpDiscount}
                    openSignal={signal}
                    isDigital={product.isDigital}
                  />
                  <button
                    type="button"
                    onClick={() => setSignal(s => s + 1)}
                    disabled={!inStock}
                    className="text-sm font-bold text-foreground disabled:text-foreground-muted"
                  >
                    {inStock ? label : 'Out of stock'}
                  </button>
                </div>
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-600 underline-offset-4 hover:underline dark:text-accent-400"
                >
                  View product
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </ScrollIn>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// Desktop: opacity/y follow the pinned scroll. Phones: reveal once in view. Reduced motion: static.
function ScrollIn({
  at,
  order,
  progress,
  driven,
  reduced,
  className,
  children,
}: {
  at: number
  order: number
  progress: MotionValue<number>
  driven: boolean
  reduced: boolean
  className?: string
  children: ReactNode
}) {
  const opacity = useTransform(progress, [at, at + REVEAL_SPAN], [0, 1])
  const y = useTransform(progress, [at, at + REVEAL_SPAN], [24, 0])
  const still = driven || reduced
  return (
    <motion.div
      className={className}
      style={driven ? { opacity, y } : undefined}
      initial={still ? false : { opacity: 0, y: 16 }}
      whileInView={still ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: order * 0.08 }}
    >
      {children}
    </motion.div>
  )
}
