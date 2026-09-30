import Link from 'next/link'
import { pickUnitPrice } from '@/lib/catalog/pricing'
import { SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.category_showcase

interface CategoryShowcaseProps {
  items: any[]
  gstEnabled?: boolean
  title?: string | null
  eyebrow?: string | null
}

export default function CategoryShowcase({ items, gstEnabled = false, title, eyebrow }: CategoryShowcaseProps) {
  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="text-accent-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
              {eyebrow ?? COPY.eyebrow}
            </p>
            <h2 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
          </div>
          <Link
            href="/categories"
            className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors"
          >
            All categories
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {items.map((cat: any) => (
            <div
              key={cat.id}
              className="bg-surface-elevated rounded-2xl border border-border-default overflow-hidden hover:border-accent-500/40 hover:shadow-lg transition-all duration-200"
            >
              {/* Category title */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <Link
                  href={`/categories/${cat.slug}`}
                  className="font-bold text-foreground hover:text-accent-500 transition-colors text-sm leading-tight"
                >
                  {cat.name}
                </Link>
                <Link
                  href={`/categories/${cat.slug}`}
                  className="text-[10px] text-accent-500 hover:text-accent-400 font-semibold whitespace-nowrap ml-2 flex-shrink-0"
                >
                  See all
                </Link>
              </div>
              {/* 2×2 product thumbnails */}
              <div className="grid grid-cols-2 gap-1 p-2 pt-1">
                {cat.products.slice(0, 4).map((p: any) => {
                  const img = p.product_images?.[0]
                  const price =
                    p.has_variants && p.variant_min_price
                      ? Number(p.variant_min_price)
                      : pickUnitPrice(
                          {
                            inclusive: Number(p.base_price),
                            exGst: p.price_ex_gst != null ? Number(p.price_ex_gst) : undefined,
                          },
                          gstEnabled
                        )
                  return (
                    <Link
                      key={p.id}
                      href={`/products/${p.slug}`}
                      className="group bg-surface rounded-xl p-2 flex flex-col gap-1.5 hover:bg-surface-secondary transition-colors"
                    >
                      <div className="aspect-square overflow-hidden rounded-lg bg-surface-secondary flex items-center justify-center">
                        {img ? (
                          <img
                            src={img.thumbnail_url || img.image_url}
                            alt={p.name}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full bg-surface-secondary rounded-lg" />
                        )}
                      </div>
                      <p className="text-[11px] font-medium text-foreground line-clamp-2 leading-tight">{p.name}</p>
                      <p className="text-[11px] font-bold text-accent-500">₹{price.toLocaleString('en-IN')}</p>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
