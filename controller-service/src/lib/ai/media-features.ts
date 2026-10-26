// Client-safe constants for AI media generation (shared by the admin routes and the UI).

export const AI_IMAGE_FEATURES = [
  'social_image',
  'product_image',
  'ads_image',
  'email_hero',
  'hero_image',
  'offer_image',
  'meta_ads_image',
  'generate_image',
  'homepage_image',
  'brand_image',
  'category_image',
  'logo_image',
  'campaign_image',
  'template_image',
] as const
export type AiImageFeature = (typeof AI_IMAGE_FEATURES)[number]

// Images for clients that can't rely on WebP (email, WhatsApp, push, social and ad networks) and
// product photos, which feed all of those; they are stored as PNG. Everything else is WebP.
export const PNG_IMAGE_FEATURES: readonly string[] = [
  'email_hero',
  'campaign_image',
  'template_image',
  'social_image',
  'ads_image',
  'meta_ads_image',
  'product_image',
] satisfies readonly AiImageFeature[]

export const AI_VIDEO_FEATURES = ['social_video', 'homepage_video', 'offer_video', 'template_video'] as const
export type AiVideoFeature = (typeof AI_VIDEO_FEATURES)[number]

export type AiQuality = 'draft' | 'standard' | 'premium'
export const AI_QUALITIES: { value: AiQuality; label: string }[] = [
  { value: 'draft', label: 'Draft (fast)' },
  { value: 'standard', label: 'Standard' },
  { value: 'premium', label: 'Premium' },
]

export interface AiSizePreset {
  key: string
  label: string
  width: number
  height: number
}

// Presets per destination, already within the gateway's 256..1536 multiples of 64 so the aspect holds.
export const AI_SIZE_PRESETS: Record<string, AiSizePreset> = {
  square: { key: 'square', label: 'Square 1:1', width: 1024, height: 1024 },
  portrait: { key: 'portrait', label: 'Portrait 4:5', width: 1024, height: 1280 },
  story: { key: 'story', label: 'Story 9:16', width: 832, height: 1472 },
  landscape: { key: 'landscape', label: 'Landscape 1.91:1', width: 1216, height: 640 },
  wide: { key: 'wide', label: 'Wide 16:9', width: 1344, height: 768 },
  hero: { key: 'hero', label: 'Hero banner 2.4:1', width: 1536, height: 640 },
}

// Veo renders 4, 6 or 8 s; the gateway takes 9:16, 16:9 and 1:1.
export const AI_VIDEO_ASPECTS = ['9:16', '16:9', '1:1'] as const
export type AiVideoAspect = (typeof AI_VIDEO_ASPECTS)[number]
export const AI_VIDEO_DURATIONS = [4, 6, 8] as const

const VIDEO_RATIO: Record<AiVideoAspect, number> = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1 }

/** The video aspect closest to a width/height (a 4:5 card takes 1:1, a 2.4:1 banner 16:9). */
export function nearestVideoAspect(width: number, height: number): AiVideoAspect {
  const r = Math.log(width / height)
  const dist = (a: AiVideoAspect) => Math.abs(Math.log(VIDEO_RATIO[a]) - r)
  return AI_VIDEO_ASPECTS.reduce<AiVideoAspect>((best, a) => (dist(a) < dist(best) ? a : best), '1:1')
}
