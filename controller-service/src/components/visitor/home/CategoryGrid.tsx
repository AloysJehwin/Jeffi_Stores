import Link from 'next/link'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import { SECTION_COPY_DEFAULTS } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.category_grid

interface CategoryGridProps {
  categories: any[]
  title?: string | null
  eyebrow?: string | null
  carousel?: boolean
  /** Tile shape (width / height); a tile still grows to fit its icon and name. */
  aspect?: number | null
}

const TILE =
  'flex flex-col items-center text-center gap-1.5 sm:gap-2.5 p-1 sm:p-4 rounded-xl sm:rounded-2xl sm:bg-surface-elevated sm:border sm:border-border-default sm:hover:border-primary-400/60 sm:hover:bg-primary-50 dark:sm:hover:bg-primary-900/10 sm:hover:shadow-lg sm:hover:-translate-y-0.5 transition-all duration-200'

export default function CategoryGrid({ categories, title, eyebrow, carousel = false, aspect }: CategoryGridProps) {
  // Phones: a compact 4-up icon grid (icon tile + label, no card); the card tile is sm and up.
  const items = categories.map(category => (
    <Link key={category.id} href={`/categories/${category.slug}`} className="group">
      <div
        className={aspect ? `${TILE} justify-center` : TILE}
        style={aspect ? { aspectRatio: aspect } : undefined}
      >
        <div className="w-14 h-14 sm:w-12 sm:h-12 bg-primary-100 dark:bg-primary-900/25 rounded-2xl sm:rounded-xl flex items-center justify-center group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40 group-active:scale-95 transition-all shrink-0">
          <CategoryIcon categoryName={category.name} className="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
        <span className="text-[11px] sm:text-xs font-semibold sm:font-bold text-foreground group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors leading-tight line-clamp-2 flex items-start sm:items-center justify-center min-h-[2rem] sm:min-h-[2.25rem] min-w-0 px-0.5">
          {category.name}
        </span>
      </div>
    </Link>
  ))

  return (
    <section className="pt-8 pb-12 md:py-20 bg-surface">
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1.5">
              {eyebrow ?? COPY.eyebrow}
            </p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
          </div>
          <Link
            href="/categories"
            className="flex items-center gap-1 min-h-[44px] sm:min-h-0 -my-2 sm:my-0 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 whitespace-nowrap transition-colors"
          >
            View All
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {carousel ? (
          <SectionCarousel ariaLabel={title ?? COPY.title} itemClassName="w-[22%] sm:w-[22%] lg:w-[12%]">
            {items}
          </SectionCarousel>
        ) : (
          <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:gap-3 lg:grid-cols-8">{items}</div>
        )}
      </div>
    </section>
  )
}
