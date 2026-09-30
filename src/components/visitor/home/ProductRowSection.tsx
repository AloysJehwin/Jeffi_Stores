import Link from 'next/link'
import ProductCard from '@/components/visitor/ProductCard'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import { productCardProps } from '@/lib/product-card-props'

interface ProductRowSectionProps {
  title: string
  eyebrow: string
  products: any[]
  gstEnabled: boolean
  viewAllHref: string
  viewAllLabel: string
  sectionClassName: string
  headingClassName: string
  eyebrowClassName: string
  gridClassName: string
  accentBarClassName?: string
  inlineViewAllArrow?: boolean
  footerCta?: { href: string; label: string }
  carousel?: boolean
  badgeFor?: (product: any) => string | null
}

export default function ProductRowSection({
  title,
  eyebrow,
  products,
  gstEnabled,
  viewAllHref,
  viewAllLabel,
  sectionClassName,
  headingClassName,
  eyebrowClassName,
  gridClassName,
  accentBarClassName,
  inlineViewAllArrow = false,
  footerCta,
  carousel = false,
  badgeFor,
}: ProductRowSectionProps) {
  const heading = (
    <div>
      <p className={eyebrowClassName}>{eyebrow}</p>
      <h2 className={headingClassName}>{title}</h2>
    </div>
  )

  const cards = products.map((product: any) => (
    <ProductCard key={product.id} {...productCardProps(product, gstEnabled)} badge={badgeFor?.(product) ?? null} />
  ))

  return (
    <section className={sectionClassName}>
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-7">
          {accentBarClassName ? (
            <div className="flex items-center gap-4">
              <div className={accentBarClassName} />
              {heading}
            </div>
          ) : (
            heading
          )}
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors"
            >
              {inlineViewAllArrow ? (
                <>
                  {viewAllLabel}{' '}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </>
              ) : (
                <>
                  {viewAllLabel}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </Link>
          )}
        </div>

        {carousel ? (
          <SectionCarousel ariaLabel={title}>{cards}</SectionCarousel>
        ) : (
          <div className={gridClassName}>{cards}</div>
        )}

        {footerCta && (
          <div className="text-center mt-8">
            <Link
              href={footerCta.href}
              className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-primary-500/20 text-sm md:text-base"
            >
              {footerCta.label}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}
