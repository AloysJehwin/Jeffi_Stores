import { z } from 'zod'

// Client-safe shape of a new image ad / image swap (the console dialog and the route share it).

export const CTA_TYPES = [
  'SHOP_NOW',
  'LEARN_MORE',
  'BUY_NOW',
  'ORDER_NOW',
  'GET_OFFER',
  'SIGN_UP',
  'SUBSCRIBE',
  'CONTACT_US',
] as const
export type CtaType = (typeof CTA_TYPES)[number]

export const CTA_LABELS: Record<CtaType, string> = {
  SHOP_NOW: 'Shop now',
  LEARN_MORE: 'Learn more',
  BUY_NOW: 'Buy now',
  ORDER_NOW: 'Order now',
  GET_OFFER: 'Get offer',
  SIGN_UP: 'Sign up',
  SUBSCRIBE: 'Subscribe',
  CONTACT_US: 'Contact us',
}

export const TEXT_LIMITS = {
  message: { recommended: 125, max: 2200 },
  headline: 40,
  description: 30,
} as const

const metaId = z.string().regex(/^\d{1,30}$/)
const httpsUrl = z.string().trim().url().max(2000).refine(u => /^https:\/\//i.test(u), 'Use an https:// link')

export const MadsNewAdSchema = z.object({
  action: z.literal('create'),
  adsetId: metaId,
  name: z.string().trim().min(1).max(200),
  imageUrl: httpsUrl,
  link: httpsUrl,
  message: z.string().trim().min(1, 'Add the primary text').max(TEXT_LIMITS.message.max),
  headline: z.string().trim().min(1, 'Add a headline').max(TEXT_LIMITS.headline),
  description: z.string().trim().max(TEXT_LIMITS.description).default(''),
  cta: z.enum(CTA_TYPES),
  status: z.enum(['PAUSED', 'ACTIVE']).default('PAUSED'),
})

export const MadsSwapImageSchema = z.object({
  action: z.literal('image'),
  adId: metaId,
  imageUrl: httpsUrl,
})

export const MadsAdSchema = z.discriminatedUnion('action', [MadsNewAdSchema, MadsSwapImageSchema])
export type MadsNewAd = z.infer<typeof MadsNewAdSchema>
export type MadsSwapImage = z.infer<typeof MadsSwapImageSchema>
export type MadsAdChange = z.infer<typeof MadsAdSchema>

/** The product link with our UTM tags, so orders from the ad attribute to Meta and the ad set. */
export function utmLink(link: string, adsetId: string): string {
  const u = new URL(link)
  u.searchParams.set('utm_source', 'facebook')
  u.searchParams.set('utm_medium', 'paid_social')
  u.searchParams.set('utm_campaign', `meta_${adsetId}`)
  return u.toString()
}
