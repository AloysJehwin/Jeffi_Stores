import type { HomeSection, HomeData, CardProduct } from '../../types/home'
import ProductRowSection, { ROW_STYLES } from './ProductRowSection'
import HeroCarousel from './HeroCarousel'
import OfferSlider from './OfferSlider'
import TrustStrip from './TrustStrip'
import PromoBanner from './PromoBanner'
import CountdownDealBanner from './CountdownDealBanner'
import DealOfTheDay from './DealOfTheDay'
import CategoryGrid from './CategoryGrid'
import BrandCarousel from './BrandCarousel'
import CategoryShowcase from './CategoryShowcase'
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

// Mirror of controller-service components/visitor/home/SectionRenderer.tsx.
const SIMPLE = {
  hero: HeroCarousel,
  motion_hero: MotionHero,
  stories: Stories,
  product_spotlight: ProductSpotlight,
  rewards_game: RewardsGame,
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
} as const

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
    default: {
      const Component = SIMPLE[section.type]
      return Component ? <Component section={section} data={data} /> : null
    }
  }
}
