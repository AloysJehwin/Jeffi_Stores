import Link from 'next/link'
import CategoryIcon from '@/components/visitor/CategoryIcon'
import SectionCarousel from '@/components/visitor/SectionCarousel'
import { SECTION_COPY_DEFAULTS } from '@/lib/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.category_grid

interface CategoryGridProps {
  categories: any[]
  title?: string | null
  eyebrow?: string | null
  carousel?: boolean
}

export default function CategoryGrid({ categories, title, eyebrow, carousel = false }: CategoryGridProps) {
  const items = categories.map((category) => (
    <Link key={category.id} href={`/categories/${category.slug}`} className="group">
      <div className="flex flex-col items-center text-center gap-2.5 p-3 sm:p-4 rounded-2xl bg-surface-elevated border border-border-default
                      hover:border-primary-400/60 hover:bg-primary-50 dark:hover:bg-primary-900/10 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200">
        <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/25 rounded-xl flex items-center justify-center group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40 transition-colors shrink-0">
          <CategoryIcon categoryName={category.name} className="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
        <span className="text-xs font-bold text-foreground group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors leading-tight line-clamp-2 flex items-center justify-center min-h-[2.25rem] min-w-0 px-0.5">
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
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1.5">{eyebrow ?? COPY.eyebrow}</p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{title ?? COPY.title}</h2>
          </div>
          <Link href="/categories" className="hidden sm:flex items-center gap-1 text-sm text-accent-500 hover:text-accent-400 font-semibold shrink-0 transition-colors">
            View All
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {carousel ? (
          <SectionCarousel ariaLabel={title ?? COPY.title} itemClassName="w-[45%] sm:w-[22%] lg:w-[12%]">
            {items}
          </SectionCarousel>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 lg:grid-cols-8">
            {items}
          </div>
        )}
      </div>
    </section>
  )
}
