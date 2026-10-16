// Feature -> the :write scope the caller must hold (with the AI plan scope) to generate media for it.
import type { AiImageFeature, AiVideoFeature } from './media-features'

export type AiFeature = AiImageFeature | AiVideoFeature

export type AiFeatureScope = 'social:write' | 'products:write' | 'google_ads_campaigns:write' | 'mailer:write' | 'settings:write' | 'coupons:write'

export const AI_FEATURE_SCOPES: Record<AiFeature, AiFeatureScope> = {
  social_image: 'social:write',
  social_video: 'social:write',
  product_image: 'products:write',
  ads_image: 'google_ads_campaigns:write',
  email_hero: 'mailer:write',
  hero_image: 'settings:write',
  offer_image: 'coupons:write',
  generate_image: 'settings:write',
}

export function scopeForFeature(feature: string): AiFeatureScope | null {
  return (AI_FEATURE_SCOPES as Record<string, AiFeatureScope>)[feature] ?? null
}
