'use client'

import type { SectionType } from '@/lib/homepage-sections'
import { DateTimeField, Grid, useSectionBinding, type EditorProps } from './editors/fields'
import AboutEditor from './editors/AboutEditor'
import BackInStockEditor from './editors/BackInStockEditor'
import BenefitsEditor from './editors/BenefitsEditor'
import BlogTeaserEditor from './editors/BlogTeaserEditor'
import BrandCarouselEditor from './editors/BrandCarouselEditor'
import BundleSpotlightEditor from './editors/BundleSpotlightEditor'
import BusinessCtaEditor from './editors/BusinessCtaEditor'
import CategoryGridEditor from './editors/CategoryGridEditor'
import CategoryShowcaseEditor from './editors/CategoryShowcaseEditor'
import CategoryTabsEditor from './editors/CategoryTabsEditor'
import CountdownDealEditor from './editors/CountdownDealEditor'
import DealOfTheDayEditor from './editors/DealOfTheDayEditor'
import FeaturedForYouEditor from './editors/FeaturedForYouEditor'
import ProductRowEditor from './editors/ProductRowEditor'
import PromoBannerEditor from './editors/PromoBannerEditor'
import RecentlyViewedEditor from './editors/RecentlyViewedEditor'
import SocialStripEditor from './editors/SocialStripEditor'
import TestimonialsEditor from './editors/TestimonialsEditor'
import TrustStripEditor from './editors/TrustStripEditor'
import ValueStatsEditor from './editors/ValueStatsEditor'
import WhyUsEditor from './editors/WhyUsEditor'

// `hero` is absent: its slides are edited by HeroSlideManager, which the settings page embeds.
const EDITORS: Partial<Record<SectionType, (props: EditorProps) => React.ReactElement>> = {
  about: AboutEditor,
  back_in_stock: BackInStockEditor,
  benefits: BenefitsEditor,
  blog_teaser: BlogTeaserEditor,
  brand_carousel: BrandCarouselEditor,
  bundle_spotlight: BundleSpotlightEditor,
  business_cta: BusinessCtaEditor,
  category_grid: CategoryGridEditor,
  category_showcase: CategoryShowcaseEditor,
  category_tabs: CategoryTabsEditor,
  countdown_deal: CountdownDealEditor,
  deal_of_the_day: DealOfTheDayEditor,
  featured_for_you: FeaturedForYouEditor,
  product_row: ProductRowEditor,
  promo_banner: PromoBannerEditor,
  recently_viewed: RecentlyViewedEditor,
  social_strip: SocialStripEditor,
  testimonials: TestimonialsEditor,
  trust_strip: TrustStripEditor,
  value_stats: ValueStatsEditor,
  why_us: WhyUsEditor,
}

export default function SectionConfigFields(props: EditorProps) {
  const Editor = EDITORS[props.section.type]

  return (
    <div className="space-y-4">
      {Editor && <Editor {...props} />}
      <Scheduling {...props} />
    </div>
  )
}

function Scheduling(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)

  return (
    <div className="pt-3 border-t border-border-default">
      <p className="text-xs font-semibold text-foreground mb-2">Scheduling</p>
      <Grid>
        <DateTimeField
          label="Show from"
          value={section.starts_at}
          disabled={!canWrite}
          placeholder="Show immediately"
          hint="Leave empty to show immediately."
          onCommit={v => b.saveColumn({ starts_at: v }, { startsAt: v })}
        />
        <DateTimeField
          label="Hide after"
          value={section.ends_at}
          disabled={!canWrite}
          placeholder="Never hide"
          hint="Use this for seasonal or sale sections."
          onCommit={v => b.saveColumn({ ends_at: v }, { endsAt: v })}
        />
      </Grid>
    </div>
  )
}
