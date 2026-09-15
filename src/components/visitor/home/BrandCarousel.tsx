import Link from 'next/link'
import SectionCarousel from '@/components/visitor/SectionCarousel'

interface BrandCarouselProps {
  brands: { id: string; name: string; slug: string; product_count: number }[]
  title?: string | null
  eyebrow?: string | null
  carousel?: boolean
}

export default function BrandCarousel({ brands, title, eyebrow, carousel = false }: BrandCarouselProps) {
  const items = brands.map(brand => (
    <Link key={brand.id} href={`/brands/${brand.slug}`}
      className="flex flex-col items-center gap-2 p-3 rounded-xl bg-surface border border-border-default hover:border-accent-500/40 hover:bg-surface-secondary transition-all group">
      <div className="w-10 h-10 rounded-full bg-accent-500/10 flex items-center justify-center">
        <span className="text-accent-600 dark:text-accent-400 text-xs font-black">{brand.name.slice(0, 2).toUpperCase()}</span>
      </div>
      <span className="text-[11px] font-semibold text-foreground text-center leading-tight line-clamp-2">{brand.name}</span>
      <span className="text-[10px] text-foreground-muted">{brand.product_count} items</span>
    </Link>
  ))

  return (
    <section className="py-8 bg-surface-elevated border-y border-border-default">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">{eyebrow ?? 'Trusted Names'}</p>
            <h2 className="text-xl md:text-2xl font-black text-foreground tracking-tight">{title ?? 'Shop by Brand'}</h2>
          </div>
          <Link href="/brands" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
            All brands <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
          </Link>
        </div>
        {carousel ? (
          <SectionCarousel ariaLabel={title ?? 'Shop by Brand'} itemClassName="w-[22%] sm:w-[12%]">
            {items}
          </SectionCarousel>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {items}
          </div>
        )}
      </div>
    </section>
  )
}
