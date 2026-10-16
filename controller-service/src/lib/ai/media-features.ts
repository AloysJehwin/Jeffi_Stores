// Client-safe constants for AI media generation (shared by the admin routes and the UI).

export const AI_IMAGE_FEATURES = [
  'social_image',
  'product_image',
  'ads_image',
  'email_hero',
  'hero_image',
  'generate_image',
] as const
export type AiImageFeature = (typeof AI_IMAGE_FEATURES)[number]

export const AI_VIDEO_FEATURES = ['social_video'] as const
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

// Veo renders 4, 6 or 8 s in 16:9 or 9:16 only.
export type AiVideoAspect = '9:16' | '16:9'
export const AI_VIDEO_DURATIONS = [4, 6, 8] as const
