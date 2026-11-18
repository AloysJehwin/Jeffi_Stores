import type { PageDoc, ThemeTokens } from '@jeffi/site-blocks'

// Showcase: a one-page site for a business (its work, proof, reviews and contacts), sold as its own service. One
// row per site in the control plane (showcase_sites); the page is a studio page doc that showcase-service renders.

export type SocialNetwork = 'instagram' | 'facebook' | 'youtube' | 'x' | 'linkedin' | 'pinterest'

export interface ShowcaseBusiness {
  name: string
  tagline?: string
  /** What the business does, in a few words ("Wedding photographer", "Dental clinic"). */
  profession?: string
  about?: string
  logo?: string | null
  phone?: string
  /** Digits with the country code. */
  whatsapp?: string
  email?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  hours?: string
  /** Absolute URLs. */
  socials?: Partial<Record<SocialNetwork, string>>
  /** A map link for the address. */
  mapUrl?: string
}

export interface ShowcaseService {
  title: string
  description?: string
  price?: string
  image?: string | null
}

export interface ShowcaseWork {
  title: string
  description?: string
  image: string
  link?: string
}

export interface ShowcaseReview {
  name: string
  quote: string
  rating?: number
  source?: string
  avatar?: string | null
}

export interface ShowcaseStat {
  label: string
  value: string
}

export interface ShowcaseFaq {
  q: string
  a: string
}

export interface ShowcaseContent {
  services: ShowcaseService[]
  work: ShowcaseWork[]
  reviews: ShowcaseReview[]
  stats: ShowcaseStat[]
  faqs: ShowcaseFaq[]
}

export type ShowcaseStatus = 'draft' | 'live' | 'paused'

export interface ShowcaseSite {
  id: string
  tenantId: string | null
  ownerId: string
  /** Served at site-{slug}.jeffistores.in. */
  slug: string
  status: ShowcaseStatus
  business: ShowcaseBusiness
  content: ShowcaseContent
  /** The page (key 'showcase:home'), from the studio or a pre-built theme; null until made. */
  page: PageDoc | null
  theme: ThemeTokens | null
  /** Hosting is paid up to here; the first month is free from the first publish. */
  paidUntil: string | null
  renew: boolean
  /** The free AI generation was used; later ones are charged to the wallet. */
  freeGenerationUsedAt: string | null
  generations: number
  customDomain: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** What the page's parts read: live, the site row; in the studio preview, the owner's draft. */
export interface ShowcaseView {
  business: ShowcaseBusiness
  content: ShowcaseContent
  /** Where the lead form posts; null in the preview, where forms are inert. */
  leadEndpoint: string | null
}

/** What the LeadForm part posts (JSON) to `leadEndpoint`. Name and one of phone or email are filled. */
export interface ShowcaseLeadInput {
  name: string
  phone?: string
  email?: string
  message?: string
  /** A honeypot: hidden from people, so a filled one is a bot. */
  website?: string
}

export const SHOWCASE_PAGE_KEY = 'showcase:home'
export const SHOWCASE_HOST_PREFIX = 'site-'
export const SHOWCASE_PRICE_INR = 200
export const SHOWCASE_FREE_DAYS = 30
/** The most a paid showcase regeneration charges the wallet. */
export const SHOWCASE_GENERATION_CAP_INR = 100

export const emptyShowcaseContent = (): ShowcaseContent => ({ services: [], work: [], reviews: [], stats: [], faqs: [] })
