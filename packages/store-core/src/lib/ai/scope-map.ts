// Feature -> the :write scope the caller must hold (with the AI plan scope) to generate media for it.
import type { AiImageFeature, AiVideoFeature } from './media-features'

export type AiFeature = AiImageFeature | AiVideoFeature

export type AiFeatureScope =
  | 'social:write'
  | 'products:write'
  | 'google_ads_campaigns:write'
  | 'mailer:write'
  | 'settings:write'
  | 'coupons:write'
  | 'meta_ads_campaigns:write'
  | 'brands:write'
  | 'categories:write'
  | 'campaigns:write'
  | 'templates:write'

export const AI_FEATURE_SCOPES: Record<AiFeature, AiFeatureScope> = {
  social_image: 'social:write',
  social_video: 'social:write',
  product_image: 'products:write',
  ads_image: 'google_ads_campaigns:write',
  email_hero: 'mailer:write',
  hero_image: 'settings:write',
  offer_image: 'coupons:write',
  meta_ads_image: 'meta_ads_campaigns:write',
  generate_image: 'settings:write',
  homepage_image: 'settings:write',
  homepage_video: 'settings:write',
  offer_video: 'coupons:write',
  brand_image: 'brands:write',
  category_image: 'categories:write',
  logo_image: 'settings:write',
  campaign_image: 'campaigns:write',
  template_image: 'templates:write',
  template_video: 'templates:write',
}

export function scopeForFeature(feature: string): AiFeatureScope | null {
  return (AI_FEATURE_SCOPES as Record<string, AiFeatureScope>)[feature] ?? null
}
