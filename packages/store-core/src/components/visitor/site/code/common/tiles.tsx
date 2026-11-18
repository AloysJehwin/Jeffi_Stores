import type { ReactNode } from 'react'
import Link from 'next/link'
import { ImageIcon, Star } from 'lucide-react'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import { safeHref, safeSrc } from '@/lib/site/code/allow'
import type { BrandView, CategoryView, OfferView, ProductView, ReviewView } from '@/lib/site/data/types'
import { responsiveImg } from '@/lib/shared/image-url'
import { portalHere } from '@/lib/site/portal'
import { CODE_ICONS } from './icons'

// Server renderers behind the engine's common code components (lib/site/code/parts/common.tsx). Every class here is
// literal, so the apps' own Tailwind build (which scans this folder) has it.

export const ASPECTS = ['auto', '1:1', '4:5', '3:4', '2:3', '4:3', '3:2', '16:9', '21:9', '3:1'] as const
const ASPECT: Record<string, string> = {
  auto: '', '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '3:4': 'aspect-[3/4]', '2:3': 'aspect-[2/3]', '4:3': 'aspect-[4/3]', '3:2': 'aspect-[3/2]',
  '16:9': 'aspect-video', '21:9': 'aspect-[21/9]', '3:1': 'aspect-[3/1]',
}
const RATIO: Record<string, number> = { '1:1': 1, '4:5': 0.8, '3:4': 0.75, '2:3': 2 / 3, '4:3': 4 / 3, '3:2': 1.5, '16:9': 16 / 9, '21:9': 21 / 9, '3:1': 3 }
const loadAttrs = (priority: boolean) =>
  priority ? ({ loading: 'eager', fetchPriority: 'high', decoding: 'sync' } as const) : ({ loading: 'lazy', decoding: 'async' } as const)

/** An elegant stand-in in the theme's colours, for a picture that doesn't exist yet (sample products, empty slots). */
export function ImagePlaceholder({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div role="img" aria-label={label || 'Image'} className={`relative isolate overflow-hidden bg-gradient-to-br from-primary-100 via-surface-secondary to-accent-100 ${className}`}>
      <span aria-hidden className="absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full bg-primary-200/60 blur-3xl" />
      <span aria-hidden className="absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full bg-accent-200/60 blur-3xl" />
      <ImageIcon aria-hidden strokeWidth={1.25} className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-primary-400/70" />
      {label && <span className="absolute inset-x-0 bottom-3 truncate px-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-primary-700/70">{label}</span>}
    </div>
  )
}

export function CodeImage({
  src,
  hoverSrc,
  alt = '',
  aspect = 'auto',
  fit = 'cover',
  sizes = '(min-width: 768px) 50vw, 100vw',
  priority = false,
  quiet = false,
  className = '',
}: {
  src?: unknown
  hoverSrc?: unknown
  alt?: string
  aspect?: string
  fit?: 'cover' | 'contain'
  sizes?: string
  priority?: boolean
  /** The live store: a missing picture is a plain brand-tinted fill, never a "no image" placeholder. */
  quiet?: boolean
  className?: string
}) {
  const url = safeSrc(src)
  const hover = safeSrc(hoverSrc)
  const box = ASPECT[aspect] ?? ''
  const objectFit = fit === 'contain' ? 'object-contain' : 'object-cover'
  if (!url && quiet) return <div aria-hidden className={`bg-gradient-to-br from-primary-100 via-surface-secondary to-accent-100 ${box || 'aspect-[4/3]'} ${className}`} />
  if (!url) return <ImagePlaceholder label={alt} className={`${box || 'aspect-[4/3]'} ${className}`} />
  if (!box && !hover)
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...responsiveImg(url, sizes)} {...loadAttrs(priority)} alt={alt} className={`${objectFit} ${className}`} />
  return (
    <div className={`group/img relative overflow-hidden bg-surface-secondary ${box} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img {...responsiveImg(url, sizes)} {...loadAttrs(priority)} alt={alt} className={`${box ? 'absolute inset-0 h-full' : 'block'} w-full ${objectFit} transition-opacity duration-500 ${hover ? 'group-hover/img:opacity-0' : ''}`} />
      {hover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img {...responsiveImg(hover, sizes)} alt="" aria-hidden loading="lazy" decoding="async" className={`absolute inset-0 h-full w-full ${objectFit} opacity-0 transition-opacity duration-500 group-hover/img:opacity-100`} />
      )}
    </div>
  )
}

export function CodeLink({ href, target, className, children }: { href?: unknown; target?: '_blank' | '_self'; className?: string; children?: ReactNode }) {
  const url = safeHref(href)
  if (!url) return <span className={className}>{children}</span>
  if (url.startsWith('/') && target !== '_blank')
    return (
      <Link href={url} className={className}>
        {children}
      </Link>
    )
  return (
    <a href={url} className={className} {...(target === '_blank' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  )
}

const ICON_SIZE: Record<string, string> = { xs: 'h-3.5 w-3.5', sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8', xl: 'h-12 w-12' }
export function CodeIcon({ name, size = 'md', strokeWidth = 1.75, className = '' }: { name: string; size?: string; strokeWidth?: number; className?: string }) {
  const Icon = CODE_ICONS[name]
  if (!Icon) return null
  return <Icon aria-hidden strokeWidth={strokeWidth} className={`${ICON_SIZE[size] ?? ICON_SIZE.md} shrink-0 ${className}`} />
}

/** ProductCard (cart, wishlist, quick add) for a ProductView, with this app's links and prices (business portal or store). */
export function ProductTile({ product, aspect, deferred }: { product: ProductView; aspect?: string; deferred?: boolean }) {
  if (!product || typeof product !== 'object' || typeof product.slug !== 'string') return null
  return (
    <ProductCard
      id={product.id}
      name={product.name}
      slug={product.slug}
      hasVariants={!!product.hasVariants}
      displayPrice={product.price?.value ?? 0}
      mrp={product.mrp?.value ?? null}
      mrpDiscount={product.discountPct ?? 0}
      effectiveStock={product.inStock ? 1 : 0}
      primaryImage={product.image ? { image_url: product.image } : null}
      brandName={product.brand}
      categoryName={product.category}
      categoryId={product.categoryId}
      badge={product.badge}
      isDigital={product.isDigital}
      imageAspect={aspect ? (RATIO[aspect] ?? null) : null}
      deferred={deferred}
      portal={portalHere()}
    />
  )
}

export function CategoryTile({ c, priority }: { c: CategoryView; priority: boolean }) {
  return (
    <Link href={c.url} className="group block">
      <CodeImage src={c.image} alt={c.name} aspect="1:1" sizes="(min-width: 768px) 25vw, 50vw" priority={priority} className="rounded-[var(--radius-card,0.75rem)]" />
      <p className="mt-2 text-sm font-semibold text-foreground">{c.name}</p>
    </Link>
  )
}

export function BrandTile({ b }: { b: BrandView }) {
  return (
    <Link href={b.url} className="flex h-20 items-center justify-center rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface px-3">
      {b.logo && safeSrc(b.logo) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img {...responsiveImg(b.logo, '160px')} loading="lazy" decoding="async" alt={b.name} className="max-h-12 max-w-full object-contain" />
      ) : (
        <span className="text-sm font-semibold text-foreground">{b.name}</span>
      )}
    </Link>
  )
}

export function ReviewCard({ r }: { r: ReviewView }) {
  return (
    <figure className="h-full rounded-[var(--radius-card,0.75rem)] border border-border-default bg-surface p-5 text-foreground">
      <div className="flex gap-0.5 text-accent-500" aria-label={`${r.rating} out of 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className={`h-4 w-4 ${i < r.rating ? 'fill-current' : 'opacity-30'}`} />
        ))}
      </div>
      <blockquote className="mt-3 text-base text-foreground-secondary">“{r.comment.length > 280 ? `${r.comment.slice(0, 277)}…` : r.comment}”</blockquote>
      <figcaption className="mt-3 text-xs text-foreground-muted">
        {r.author} on{' '}
        <Link href={r.productUrl} className="underline">
          {r.productName}
        </Link>
      </figcaption>
    </figure>
  )
}

export function OfferCard({ o, priority }: { o: OfferView; priority: boolean }) {
  return (
    <Link href={o.url} className="group relative block overflow-hidden rounded-[var(--radius-card,0.75rem)] bg-surface-secondary">
      <CodeImage src={o.image} alt={o.title} aspect="4:5" sizes="(min-width: 768px) 33vw, 100vw" priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        {o.badge && <span className="mb-2 inline-block rounded-full bg-accent-500 px-2 py-0.5 text-xs font-semibold">{o.badge}</span>}
        <p className="font-display text-xl">{o.title}</p>
        {o.subtitle && <p className="text-sm opacity-90">{o.subtitle}</p>}
      </div>
    </Link>
  )
}

/** A data component's items: a grid (the AI's className, or a default), a swipeable rail, or a plain stack. */
export function ItemsLayout({
  layout,
  className,
  itemClassName,
  label,
  fallbackGrid,
  children,
}: {
  layout: 'grid' | 'carousel' | 'list'
  className?: string
  itemClassName?: string
  label: string
  fallbackGrid: string
  children: ReactNode[]
}) {
  if (layout === 'carousel')
    return (
      <div className={className}>
        <SectionCarousel ariaLabel={label} itemClassName={itemClassName || 'w-[45%] md:w-[23%]'}>
          {children}
        </SectionCarousel>
      </div>
    )
  if (layout === 'list') return <div className={className || 'flex flex-col gap-4'}>{children}</div>
  return <div className={className || fallbackGrid}>{children}</div>
}
