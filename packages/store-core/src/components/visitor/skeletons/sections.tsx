import type { ReactNode } from 'react'
import { Sk } from '@/components/admin/kit/skeleton'
import { HALF_CELL, HALF_ROW } from '@/components/visitor/home/layout-classes'
import type { LayoutSection } from '@/lib/catalog/homepage-layout'
import type { SectionSide, SectionType } from '@/lib/catalog/homepage-sections'
import { ProductCardSkeleton, type GridInsert } from './listing'

// One loading placeholder per homepage section type, shaped like the real section (same outer
// padding, background, grid) so the page lands on it without shifting. HomeLayoutSkeleton lays
// them out as HomeSections does: one per row, or a left + right pair side by side on lg+.
// Server-safe: loading.tsx renders these.

const CARD = 'rounded-2xl border border-border-default bg-surface-elevated'
const EYEBROW = 'h-2.5 w-20'
const HEADING = 'h-7 md:h-9 w-56 max-w-full'

/** The product rows' "accent bar + eyebrow + heading + view all" head. */
function RowHead({ bar = true, viewAll = true }: { bar?: boolean; viewAll?: boolean }) {
  return (
    <div className="flex items-end justify-between mb-7">
      <div className="flex items-center gap-4">
        {bar && <div className="w-1 h-10 bg-primary-500/40 rounded-full" />}
        <div className="space-y-2">
          <Sk className={EYEBROW} />
          <Sk className={HEADING} />
        </div>
      </div>
      {viewAll && <Sk className="h-4 w-16" />}
    </div>
  )
}

/** A centred eyebrow + heading (benefits, why us, testimonials, stats). */
function CentredHead() {
  return (
    <div className="flex flex-col items-center gap-2 mb-8">
      <Sk className={EYEBROW} />
      <Sk className="h-7 md:h-9 w-64 max-w-full" />
    </div>
  )
}

function Cards({ n, className }: { n: number; className: string }) {
  return (
    <div className={className}>
      {Array.from({ length: n }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}

// SectionRenderer's ROW_STYLES by product row index.
const ROW_SECTION = ['py-12 md:py-20 bg-surface-secondary', 'py-12 md:py-20 bg-surface', 'py-12 md:py-16 bg-surface-secondary']
const ROW_GRID = [
  'grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5',
  'grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5',
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4',
]

function ProductRowSkeleton({ rowIndex }: { rowIndex: number }) {
  const i = rowIndex % ROW_SECTION.length
  return (
    <section className={ROW_SECTION[i]}>
      <div className="container mx-auto px-4">
        <RowHead bar={i < 2} />
        <Cards n={4} className={ROW_GRID[i]} />
      </div>
    </section>
  )
}

function Hero() {
  return (
    <div className="bg-surface px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6 h-[clamp(20rem,60svh,32rem)] sm:h-[clamp(22rem,58svh,34rem)] lg:h-[clamp(24rem,56svh,38rem)]">
      <Sk className="w-full h-full rounded-2xl" />
    </div>
  )
}

function MotionHero() {
  return (
    <div className="bg-surface px-3 sm:px-6 md:px-8 pt-3 pb-4">
      <Sk className="w-full rounded-2xl h-[clamp(20rem,56svh,36rem)] md:h-[clamp(26rem,64vh,46rem)]" />
    </div>
  )
}

function Banner({ className = 'min-h-[14rem] md:min-h-[20rem]', section = 'py-8 md:py-12 bg-surface' }: { className?: string; section?: string }) {
  return (
    <section className={section}>
      <div className="container mx-auto px-4">
        <Sk className={`w-full rounded-2xl ${className}`} />
      </div>
    </section>
  )
}

function OfferSlider() {
  return (
    <section className="bg-surface px-3 sm:px-6 md:px-8 py-6 md:py-8">
      <div className="flex flex-col items-center gap-2 mb-5">
        <Sk className={EYEBROW} />
        <Sk className="h-7 w-48" />
      </div>
      <div className="flex justify-center gap-4 overflow-hidden">
        <Sk className="hidden md:block w-[26%] aspect-[4/5] rounded-2xl opacity-60" />
        <Sk className="w-[88%] md:w-[40%] aspect-[4/5] md:aspect-[4/3] rounded-2xl" />
        <Sk className="hidden md:block w-[26%] aspect-[4/5] rounded-2xl opacity-60" />
      </div>
    </section>
  )
}

function TrustStrip() {
  return (
    <div className="bg-surface-elevated border-b border-border-default">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`flex items-center gap-3 px-3 sm:px-4 py-3 sm:justify-center ${i % 2 ? 'max-sm:border-l' : ''} ${i >= 2 ? 'max-sm:border-t' : ''} ${i ? 'sm:border-l' : ''} border-border-default`}>
              <Sk className="w-5 h-5 rounded-full shrink-0" />
              <Sk className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CategoryGrid() {
  return (
    <section className="pt-8 pb-12 md:py-20 bg-surface">
      <div className="container mx-auto px-4">
        <RowHead bar={false} />
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:gap-3 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`flex flex-col items-center gap-1.5 sm:gap-2.5 p-1 sm:p-4 rounded-xl sm:rounded-2xl sm:bg-surface-elevated sm:border sm:border-border-default ${i >= 4 ? 'hidden lg:flex' : ''}`}>
              <Sk className="w-14 h-14 sm:w-12 sm:h-12 rounded-2xl sm:rounded-xl" />
              <div className="min-h-[2rem] sm:min-h-[2.25rem] w-full flex items-start sm:items-center justify-center">
                <Sk className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function BrandCarousel() {
  return (
    <section className="py-8 bg-surface-elevated border-y border-border-default">
      <div className="container mx-auto px-4">
        <RowHead bar={false} />
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`flex flex-col items-center gap-2 p-3 rounded-xl border border-border-default bg-surface ${i >= 4 ? 'hidden sm:flex' : ''}`}>
              <Sk className="w-10 h-10 rounded-full" />
              <Sk className="h-3 w-4/5" />
              <Sk className="h-2.5 w-10" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CategoryShowcase() {
  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto px-4">
        <RowHead bar={false} viewAll={false} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${CARD} overflow-hidden rounded-xl`}>
              <div className="flex items-center justify-between px-3 py-2.5">
                <Sk className="h-4 w-1/2" />
                <Sk className="h-3 w-10" />
              </div>
              <div className="grid grid-cols-2 gap-1 p-2 pt-1">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Sk key={j} className="aspect-square rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Tiles({ section, head, n, cols, tile }: { section: string; head: ReactNode; n: number; cols: string; tile: ReactNode }) {
  return (
    <section className={section}>
      <div className="container mx-auto px-4">
        {head}
        <div className={cols}>
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="contents">
              {tile}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const Benefits = () => (
  <Tiles
    section="py-8 bg-surface border-y border-border-default"
    head={<CentredHead />}
    n={3}
    cols="grid grid-cols-1 sm:grid-cols-3 gap-4"
    tile={
      <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-elevated border border-border-default">
        <Sk className="w-10 h-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <Sk className="h-3.5 w-2/3" />
          <Sk className="h-3 w-full" />
        </div>
      </div>
    }
  />
)

const WhyUs = () => (
  <Tiles
    section="py-12 md:py-20 bg-surface-secondary"
    head={<CentredHead />}
    n={3}
    cols="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6"
    tile={
      <div className={`${CARD} p-6 md:p-8`}>
        <Sk className="w-12 h-12 rounded-xl mb-5" />
        <Sk className="h-5 w-1/2 mb-3" />
        <Sk className="h-3 w-full mb-1.5" />
        <Sk className="h-3 w-5/6" />
      </div>
    }
  />
)

const Testimonials = () => (
  <Tiles
    section="py-12 md:py-16 bg-surface-secondary"
    head={<CentredHead />}
    n={3}
    cols="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    tile={
      <div className={`${CARD} p-5`}>
        <Sk className="h-3.5 w-24 mb-4" />
        <Sk className="h-3 w-full mb-1.5" />
        <Sk className="h-3 w-full mb-1.5" />
        <Sk className="h-3 w-2/3 mb-5" />
        <div className="flex items-center gap-3 border-t border-border-default pt-3">
          <Sk className="w-9 h-9 rounded-full" />
          <div className="space-y-1.5">
            <Sk className="h-3 w-24" />
            <Sk className="h-2.5 w-16" />
          </div>
        </div>
      </div>
    }
  />
)

const ValueStats = () => (
  <Tiles
    section="py-12 md:py-16 bg-surface"
    head={<CentredHead />}
    n={4}
    cols="grid gap-4 grid-cols-2 md:grid-cols-4"
    tile={
      <div className={`${CARD} p-5 md:p-6 flex flex-col items-center gap-3`}>
        <Sk className="h-8 md:h-12 w-20" />
        <Sk className="h-3 w-24" />
      </div>
    }
  />
)

function About() {
  return (
    <section className="py-12 md:py-20 bg-surface">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-20 items-center">
          <Sk className="w-full h-56 sm:h-80 md:h-[440px] rounded-2xl" />
          <div className="space-y-4">
            <Sk className={EYEBROW} />
            <Sk className="h-8 md:h-10 w-3/4" />
            <Sk className="h-3.5 w-full" />
            <Sk className="h-3.5 w-full" />
            <Sk className="h-3.5 w-2/3" />
            <Sk className="h-11 w-40 rounded-lg mt-2" />
          </div>
        </div>
      </div>
    </section>
  )
}

function BusinessCta() {
  return (
    <div className="px-3 sm:px-6 md:px-8 py-3 md:py-6 bg-surface">
      <Sk className="w-full rounded-2xl min-h-[340px] md:min-h-[400px]" />
    </div>
  )
}

function CountdownDeal() {
  return (
    <section className="py-10 md:py-14 bg-surface">
      <div className="container mx-auto px-4">
        <div className={`${CARD} grid md:grid-cols-2 items-center gap-6 md:gap-10 p-5 md:p-10`}>
          <Sk className="w-full max-w-sm mx-auto aspect-square rounded-xl" />
          <div className="space-y-4">
            <Sk className={EYEBROW} />
            <Sk className="h-8 w-3/4" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Sk key={i} className="h-12 w-12 rounded-lg" />
              ))}
            </div>
            <Sk className="h-11 w-36 rounded-lg" />
          </div>
        </div>
      </div>
    </section>
  )
}

function CategoryTabs() {
  return (
    <section className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <RowHead bar={false} viewAll={false} />
        <div className="flex gap-2 mb-6 overflow-hidden">
          {['w-24', 'w-20', 'w-28', 'w-20'].map(w => (
            <Sk key={w} className={`h-9 ${w} rounded-full`} />
          ))}
        </div>
        <Cards n={4} className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5" />
      </div>
    </section>
  )
}

function BlogTeaser() {
  return (
    <section className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <RowHead bar={false} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`${CARD} overflow-hidden rounded-xl`}>
              <Sk className="aspect-[16/9] w-full rounded-none" />
              <div className="p-4 space-y-2">
                <Sk className="h-4 w-3/4" />
                <Sk className="h-3 w-full" />
                <Sk className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SocialStrip() {
  return (
    <section className="py-12 md:py-16 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <RowHead bar={false} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Sk key={i} className={`aspect-square rounded-xl ${i >= 2 ? 'hidden sm:block' : ''} ${i >= 3 ? 'lg:block' : ''}`} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Stories() {
  return (
    <section className="bg-surface py-10 md:py-14">
      <div className="container mx-auto px-4">
        <RowHead viewAll={false} />
        <div className="grid grid-flow-col auto-cols-[minmax(5.5rem,1fr)] md:auto-cols-[minmax(6.5rem,1fr)] gap-4 overflow-hidden pt-1 pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Sk className="w-[4.5rem] h-[4.5rem] md:w-20 md:h-20 rounded-full" />
              <Sk className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Spotlight() {
  return (
    <section className="bg-surface-secondary">
      <div className="container mx-auto px-4 py-12">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14">
          <Sk className="aspect-square w-full rounded-[2rem]" />
          <div className="space-y-4">
            <Sk className={EYEBROW} />
            <Sk className="h-9 w-3/4" />
            <Sk className="h-4 w-full" />
            <Sk className="h-4 w-5/6" />
            <Sk className="h-11 w-40 rounded-lg" />
          </div>
        </div>
      </div>
    </section>
  )
}

function RewardsGame() {
  return (
    <section className="py-12 md:py-20 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className="space-y-4">
            <Sk className={EYEBROW} />
            <Sk className="h-9 w-3/4" />
            <Sk className="h-4 w-full" />
            <Sk className="h-11 w-40 rounded-lg" />
          </div>
          <Sk className="mx-auto aspect-square w-full max-w-[320px] rounded-full" />
        </div>
      </div>
    </section>
  )
}

function Slides() {
  return (
    <section className="bg-surface py-6 md:py-8">
      <div className="container mx-auto px-4">
        <div className="flex items-center gap-4 mb-5 md:mb-7">
          <div className="w-1 h-10 bg-primary-500/40 rounded-full" />
          <div className="space-y-2">
            <Sk className={EYEBROW} />
            <Sk className={HEADING} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Sk key={i} className="aspect-[4/5] rounded-2xl" />
          ))}
        </div>
      </div>
    </section>
  )
}

function BusinessQuotes() {
  return (
    <section className="py-12 md:py-16 bg-surface">
      <div className="container mx-auto px-4">
        <div className="grid gap-5 lg:grid-cols-5">
          <div className={`${CARD} p-6 lg:col-span-2 space-y-4`}>
            <Sk className="h-7 w-1/2" />
            <Sk className="h-3.5 w-full" />
            <Sk className="h-11 w-40 rounded-lg" />
          </div>
          <div className={`${CARD} p-6 lg:col-span-3 space-y-3`}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Sk key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function BusinessAccount() {
  return (
    <section className="py-12 md:py-16 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <RowHead bar={false} viewAll={false} />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`${CARD} p-5 space-y-3`}>
              <Sk className="h-4 w-1/3" />
              <Sk className="h-8 w-1/2" />
              <Sk className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

type Draw = (ctx: { rowIndex: number }) => ReactNode

/** Every section type's placeholder; null for ones that stay hidden until a visitor has data. */
export const SECTION_SKELETONS: Record<SectionType, Draw> = {
  hero: () => <Hero />,
  motion_hero: () => <MotionHero />,
  offer_slider: () => <OfferSlider />,
  trust_strip: () => <TrustStrip />,
  category_grid: () => <CategoryGrid />,
  brand_carousel: () => <BrandCarousel />,
  product_row: ({ rowIndex }) => <ProductRowSkeleton rowIndex={rowIndex} />,
  category_showcase: () => <CategoryShowcase />,
  deal_of_the_day: () => (
    <section className="py-12 md:py-20 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <RowHead bar={false} />
        <Cards n={4} className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5" />
      </div>
    </section>
  ),
  promo_banner: () => <Banner />,
  featured_for_you: () => null,
  benefits: () => <Benefits />,
  why_us: () => <WhyUs />,
  about: () => <About />,
  business_cta: () => <BusinessCta />,
  countdown_deal: () => <CountdownDeal />,
  testimonials: () => <Testimonials />,
  recently_viewed: () => null,
  category_tabs: () => <CategoryTabs />,
  bundle_spotlight: () => <ProductRowSkeleton rowIndex={1} />,
  back_in_stock: () => null,
  blog_teaser: () => <BlogTeaser />,
  social_strip: () => <SocialStrip />,
  value_stats: () => <ValueStats />,
  stories: () => <Stories />,
  product_spotlight: () => <Spotlight />,
  rewards_game: () => <RewardsGame />,
  slides: () => <Slides />,
  business_reorder: ({ rowIndex }) => <ProductRowSkeleton rowIndex={rowIndex} />,
  business_offers: ({ rowIndex }) => <ProductRowSkeleton rowIndex={rowIndex} />,
  business_quotes: () => <BusinessQuotes />,
  business_account: () => <BusinessAccount />,
}

const isRow = (type: SectionType) => type === 'product_row' || type === 'business_reorder' || type === 'business_offers'

export function SectionSkeleton({ type, rowIndex = 0 }: { type: SectionType; rowIndex?: number }) {
  return <>{(SECTION_SKELETONS[type] ?? (() => null))({ rowIndex })}</>
}

/** groupRows over the descriptor: a left immediately followed by a right shares a row. */
export function groupLayoutRows<T extends { side: SectionSide }>(sections: T[]): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const next = sections[i + 1]
    if (s.side === 'left' && next && next.side === 'right') {
      rows.push([s, next])
      i++
    } else rows.push([s])
  }
  return rows
}

/** The page's sections, as HomeSections lays them out, each drawn as its placeholder. */
export function HomeLayoutSkeleton({ sections, label = 'Loading home' }: { sections: LayoutSection[]; label?: string }) {
  let rowIndex = 0
  const draw = (s: LayoutSection, key: number) => (
    <SectionSkeleton key={key} type={s.type} rowIndex={isRow(s.type) ? rowIndex++ : rowIndex} />
  )
  let n = 0
  return (
    <div className="bg-surface" role="status" aria-busy="true" aria-label={label}>
      {groupLayoutRows(sections).map(row => {
        const key = n
        n += row.length
        return row.length === 2 ? (
          <div key={key} className={HALF_ROW}>
            {row.map((s, i) => (
              <div key={key + i} className={HALF_CELL}>
                {draw(s, key + i)}
              </div>
            ))}
          </div>
        ) : (
          draw(row[0], key)
        )
      })}
    </div>
  )
}

/** A two-column or full-width section the listing skeleton splices between its product cards. */
export function ListingSectionSkeleton({ section, partner }: { section: LayoutSection; partner?: LayoutSection }) {
  const wrap = 'col-span-full min-w-0 overflow-hidden rounded-2xl [&_.container]:max-w-none [&_.container]:px-0 [&>section]:py-6 md:[&>section]:py-8'
  return partner ? (
    <div className={`${wrap} ${HALF_ROW}`}>
      <div className={HALF_CELL}>
        <SectionSkeleton type={section.type} />
      </div>
      <div className={HALF_CELL}>
        <SectionSkeleton type={partner.type} />
      </div>
    </div>
  ) : (
    <div className={wrap}>
      <SectionSkeleton type={section.type} />
    </div>
  )
}

/**
 * Where a listing's sections sit in its loading grid: each one after the Nth card as on the page
 * (placementsOnPage), the grid grown to reach the last of them. Page 1 only: loading.tsx has no
 * page number, and a deeper page lands on the same shape.
 */
export function listingInserts(
  sections: LayoutSection[],
  { count = 6, pageSize = 60 }: { count?: number; pageSize?: number } = {}
): { count: number; inserts: GridInsert[] } {
  const inserts: GridInsert[] = []
  let cards = count
  for (const [section, partner] of groupLayoutRows(sections)) {
    const at = section.after ?? 0
    if (at >= pageSize) continue
    inserts.push({ at, node: <ListingSectionSkeleton section={section} partner={partner} /> })
    cards = Math.max(cards, Math.min(pageSize, at + 4))
  }
  inserts.sort((a, b) => a.at - b.at)
  return { count: cards, inserts }
}
