import Link from 'next/link'
import { Package } from 'lucide-react'
import StoreImage from '@/components/visitor/StoreImage'
import DealCountdown from './DealCountdown'
import type { CardProps } from '@/lib/catalog/product-card-props'
import { SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.countdown_deal

const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface CountdownDealBannerProps {
  product: CardProps
  endsAt: string | null
  eyebrow?: string | null
  title?: string | null
  ctaLabel?: string | null
}

export default function CountdownDealBanner({ product, endsAt, eyebrow, title, ctaLabel }: CountdownDealBannerProps) {
  const href = `/products/${product.slug}`
  const image = product.primaryImage
  const showMrp = product.mrp != null && product.mrp > product.displayPrice

  return (
    <section className="py-10 md:py-14 bg-surface">
      <div className="container mx-auto px-4">
        <div className="overflow-hidden rounded-2xl border border-border-default bg-gradient-to-br from-primary-500/10 via-surface-elevated to-accent-500/10">
          <div className="grid md:grid-cols-2 items-center gap-6 md:gap-10 p-5 md:p-10">
            <Link
              href={href}
              className="relative block w-full max-w-sm mx-auto aspect-square rounded-xl bg-surface-elevated overflow-hidden"
            >
              {image ? (
                <StoreImage
                  src={image.image_url}
                  alt={product.name}
                  blurhash={image.blurhash}
                  className="w-full h-full object-contain p-4"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Package className="w-16 h-16 text-foreground-muted" aria-hidden="true" />
                </div>
              )}
              {product.mrpDiscount > 0 && (
                <span className="absolute top-3 left-3 bg-accent-500 dark:bg-accent-600 text-white px-2.5 py-1 rounded-full text-sm font-bold">
                  {product.mrpDiscount}% off
                </span>
              )}
            </Link>

            <div className="flex flex-col items-center md:items-start text-center md:text-left gap-3">
              <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em]">
                {eyebrow ?? COPY.eyebrow}
              </p>
              <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
              {product.brandName && (
                <p className="text-xs font-medium uppercase tracking-wide text-accent-600 dark:text-accent-400">
                  {product.brandName}
                </p>
              )}
              <Link
                href={href}
                className="text-lg md:text-xl font-semibold text-foreground hover:text-accent-600 transition-colors"
              >
                {product.name}
              </Link>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-black text-primary-600 dark:text-primary-400">
                  {product.hasVariants ? 'From ' : ''}&#x20B9;{inr(Number(product.displayPrice))}
                </span>
                {showMrp && (
                  <span className="text-base text-foreground-muted line-through">
                    &#x20B9;{inr(Number(product.mrp))}
                  </span>
                )}
              </div>
              {endsAt && (
                <div className="flex flex-col items-center md:items-start gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    Offer ends in
                  </span>
                  <DealCountdown endsAt={endsAt} />
                </div>
              )}
              <Link
                href={href}
                className="mt-2 inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary-500/20"
              >
                {ctaLabel ?? COPY.ctaLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
