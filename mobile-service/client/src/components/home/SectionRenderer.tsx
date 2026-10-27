import type { HomeSection, HomeData, CardProduct } from '../../types/home'
import ProductRowSection, { ProductPair, ProductRowHead, ROW_STYLES, type RowStyle } from './ProductRowSection'
import HeroCarousel from './HeroCarousel'
import OfferSlider from './OfferSlider'
import TrustStrip from './TrustStrip'
import PromoBanner from './PromoBanner'
import CountdownDealBanner from './CountdownDealBanner'
import DealOfTheDay, { DealHead } from './DealOfTheDay'
import CategoryGrid from './CategoryGrid'
import BrandCarousel from './BrandCarousel'
import CategoryShowcase, { ShowcaseHead, ShowcaseRow } from './CategoryShowcase'
import CategoryTabs from './CategoryTabs'
import FeaturedForYou from './FeaturedForYou'
import RecentlyViewed from './RecentlyViewed'
import Benefits from './Benefits'
import WhyUs from './WhyUs'
import AboutSection from './AboutSection'
import BusinessCta from './BusinessCta'
import TestimonialWall from './TestimonialWall'
import BlogTeaser from './BlogTeaser'
import SocialStrip from './SocialStrip'
import ValueStats from './ValueStats'
import MotionHero from './MotionHero'
import Stories from './Stories'
import ProductSpotlight from './ProductSpotlight'
import RewardsGame from './RewardsGame'
import SlidesSection from './SlidesSection'
import BusinessReorder from './business/BusinessReorder'
import BusinessOffers from './business/BusinessOffers'
import BusinessQuotes from './business/BusinessQuotes'
import BusinessAccount from './business/BusinessAccount'

// Mirror of controller-service components/visitor/home/SectionRenderer.tsx.
const SIMPLE = {
  hero: HeroCarousel,
  motion_hero: MotionHero,
  stories: Stories,
  product_spotlight: ProductSpotlight,
  rewards_game: RewardsGame,
  slides: SlidesSection,
  offer_slider: OfferSlider,
  trust_strip: TrustStrip,
  promo_banner: PromoBanner,
  countdown_deal: CountdownDealBanner,
  deal_of_the_day: DealOfTheDay,
  category_grid: CategoryGrid,
  brand_carousel: BrandCarousel,
  category_showcase: CategoryShowcase,
  category_tabs: CategoryTabs,
  featured_for_you: FeaturedForYou,
  recently_viewed: RecentlyViewed,
  benefits: Benefits,
  why_us: WhyUs,
  about: AboutSection,
  business_cta: BusinessCta,
  testimonials: TestimonialWall,
  blog_teaser: BlogTeaser,
  social_strip: SocialStrip,
  value_stats: ValueStats,
  business_quotes: BusinessQuotes,
  business_account: BusinessAccount,
} as const

/** Rows that take a turn in the product rows' alternating look. */
const isRow = (type: HomeSection['type']) => type === 'product_row' || type === 'business_reorder' || type === 'business_offers'

export default function SectionRenderer({ section, data, rowIndex }: { section: HomeSection; data: HomeData; rowIndex: number }) {
  const carousel = section.layout === 'carousel'
  switch (section.type) {
    case 'product_row': {
      const products = data.productRows[section.id] ?? []
      if (products.length === 0) return null
      return (
        <ProductRowSection
          title={section.copy.title ?? 'Products'}
          eyebrow={section.copy.eyebrow ?? ''}
          products={products}
          carousel={carousel}
          style={ROW_STYLES[rowIndex % ROW_STYLES.length]}
          aspect={section.aspect}
        />
      )
    }
    case 'bundle_spotlight':
    case 'back_in_stock': {
      const products = (data.extras[section.id] as CardProduct[] | undefined) ?? []
      if (products.length === 0) return null
      return (
        <ProductRowSection
          title={section.copy.title ?? ''}
          eyebrow={section.copy.eyebrow ?? ''}
          products={products}
          carousel={carousel}
          style={ROW_STYLES[section.type === 'bundle_spotlight' ? 1 : 2]}
        />
      )
    }
    // The signed-in business's own products, loaded per user, so they stay one item in the feed.
    case 'business_reorder':
      return <BusinessReorder section={section} data={data} style={ROW_STYLES[rowIndex % ROW_STYLES.length]} />
    case 'business_offers':
      return <BusinessOffers section={section} data={data} style={ROW_STYLES[rowIndex % ROW_STYLES.length]} />
    default: {
      const Component = SIMPLE[section.type]
      return Component ? <Component section={section} data={data} /> : null
    }
  }
}

// The home feed's items. A grid of cards becomes its heading plus one item per row of two, so the feed
// mounts (and unmounts) it a row at a time instead of a whole section of cards in one frame mid-scroll.

type Rows =
  | { kind: 'products'; products: CardProduct[]; title: string; eyebrow: string; style: RowStyle; aspect?: number | null }
  | { kind: 'deal'; products: CardProduct[] }
  | { kind: 'showcase'; cats: HomeData['categoryShowcase']; aspect?: number | null }

export type FeedItem =
  | { key: string; type: 'section'; section: HomeSection; rowIndex: number }
  | { key: string; type: 'head'; section: HomeSection; rows: Rows }
  | { key: string; type: 'row'; rows: Rows; products: CardProduct[]; cats: HomeData['categoryShowcase']; last: boolean }

function gridRows(section: HomeSection, data: HomeData, rowIndex: number): Rows | null {
  if (section.layout === 'carousel' && section.type !== 'deal_of_the_day' && section.type !== 'category_showcase') return null
  switch (section.type) {
    case 'product_row':
      return {
        kind: 'products',
        products: data.productRows[section.id] ?? [],
        title: section.copy.title ?? 'Products',
        eyebrow: section.copy.eyebrow ?? '',
        style: ROW_STYLES[rowIndex % ROW_STYLES.length],
        aspect: section.aspect,
      }
    case 'bundle_spotlight':
    case 'back_in_stock':
      return {
        kind: 'products',
        products: (data.extras[section.id] as CardProduct[] | undefined) ?? [],
        title: section.copy.title ?? '',
        eyebrow: section.copy.eyebrow ?? '',
        style: ROW_STYLES[section.type === 'bundle_spotlight' ? 1 : 2],
      }
    case 'deal_of_the_day':
      return { kind: 'deal', products: data.dealOfTheDay }
    case 'category_showcase':
      return { kind: 'showcase', cats: data.categoryShowcase, aspect: section.aspect }
    default:
      return null
  }
}

const rowCount = (rows: Rows) => (rows.kind === 'showcase' ? rows.cats.length : rows.products.length)

export function feedItems(sections: HomeSection[], data: HomeData): FeedItem[] {
  const out: FeedItem[] = []
  let n = 0
  for (const section of sections) {
    // Each product row's position among the rows, for its alternating style.
    const rowIndex = isRow(section.type) ? n++ : n
    const rows = gridRows(section, data, rowIndex)
    if (!rows) {
      out.push({ key: section.id, type: 'section', section, rowIndex })
      continue
    }
    const count = rowCount(rows)
    if (count === 0) continue
    out.push({ key: `${section.id}:head`, type: 'head', section, rows })
    for (let i = 0; i < count; i += 2) {
      out.push({
        key: `${section.id}:${i}`,
        type: 'row',
        rows,
        products: rows.kind === 'showcase' ? [] : rows.products.slice(i, i + 2),
        cats: rows.kind === 'showcase' ? rows.cats.slice(i, i + 2) : [],
        last: i + 2 >= count,
      })
    }
  }
  return out
}

export function FeedItemView({ item, data }: { item: FeedItem; data: HomeData }) {
  if (item.type === 'section') return <SectionRenderer section={item.section} data={data} rowIndex={item.rowIndex} />
  const { rows } = item
  if (item.type === 'head') {
    if (rows.kind === 'products') return <ProductRowHead title={rows.title} eyebrow={rows.eyebrow} style={rows.style} />
    return rows.kind === 'deal' ? <DealHead section={item.section} /> : <ShowcaseHead section={item.section} />
  }
  if (rows.kind === 'showcase') return <ShowcaseRow cats={item.cats} last={item.last} aspect={rows.aspect} />
  const bg = rows.kind === 'deal' ? 'bg-surface-secondary' : rows.style.section
  const gap = rows.kind === 'deal' ? 12 : rows.style.gap
  return <ProductPair products={item.products} bg={bg} gap={gap} last={item.last} aspect={rows.kind === 'deal' ? null : rows.aspect} />
}
