import { INDIA, type CampaignSpec, type KeywordSpec } from './campaign-spec'
import { cleanKeyword } from './limits'

// "Promote ecom" presets for the flagship's own Google Ads account: Search campaigns that send people to the ecom
// site. Client-safe (no env, no database): the server passes the ecom origin in.

export const ECOM_PRESET_IDS = ['ecom_store', 'ecom_showcase'] as const
export type EcomPresetId = (typeof ECOM_PRESET_IDS)[number]

const EN = 'languageConstants/1000'
const HI = 'languageConstants/1023'

export interface EcomPreset {
  id: EcomPresetId
  label: string
  blurb: string
  /** Campaign name; also the utm_campaign value. */
  name: string
  dailyBudget: number
  adGroupName: string
  keywords: KeywordSpec[]
  negatives: KeywordSpec[]
  headlines: string[]
  descriptions: string[]
  path1: string
  path2: string
  finalUrl: string
  locations: { id: string; name: string }[]
  languages: string[]
}

/** Only the flagship, connected through the platform account, may promote ecom. */
export function ecomPresetsAvailable(c: { flagship?: boolean; connectedVia?: string | null } | null | undefined): boolean {
  return !!c && c.flagship === true && c.connectedVia === 'platform'
}

/** The ecom origin without a trailing slash. */
export function ecomOrigin(env: Record<string, string | undefined> = process.env): string {
  const root = env.PLATFORM_ROOT_DOMAIN || env.PLATFORM_DOMAIN || 'jeffistores.in'
  return (env.NEXT_PUBLIC_ECOM_URL || `https://ecom.${root}`).replace(/\/+$/, '')
}

/** origin + path with utm_source=google, utm_medium=cpc and utm_campaign=<campaign>. */
export function utmUrl(origin: string, path: string, campaign: string): string {
  const u = new URL(path, `${origin.replace(/\/+$/, '')}/`)
  u.searchParams.set('utm_source', 'google')
  u.searchParams.set('utm_medium', 'cpc')
  u.searchParams.set('utm_campaign', campaign)
  return u.toString()
}

const kw = (list: string[], matchType: KeywordSpec['matchType']): KeywordSpec[] =>
  list.map(text => ({ text: cleanKeyword(text), matchType }))

const COMMON_NEGATIVES = [
  'jobs', 'job', 'salary', 'course', 'courses', 'tutorial', 'training', 'download', 'crack', 'pdf', 'template',
  'wordpress', 'github', 'open source', 'login', 'sign in', 'customer care', 'complaint', 'refund',
]

export function buildEcomPresets(origin: string): EcomPreset[] {
  const base = {
    locations: [INDIA],
    languages: [EN, HI],
  }
  return [
    {
      ...base,
      id: 'ecom_store',
      label: 'Online store for your business',
      blurb: 'Search ads for people looking to start an online store. Lands on the ecom home page.',
      name: 'Ecom - Online store',
      dailyBudget: 500,
      adGroupName: 'Online store',
      keywords: [
        ...kw(['create online store', 'start online store', 'online store builder', 'ecommerce website builder', 'sell online india'], 'EXACT'),
        ...kw(['online store for my business', 'build ecommerce website', 'start selling online', 'ecommerce platform india'], 'PHRASE'),
      ],
      negatives: kw([...COMMON_NEGATIVES, 'shopify login', 'amazon seller login', 'flipkart seller login', 'free download', 'dropshipping course'], 'PHRASE'),
      headlines: [
        'Start Your Online Store',
        'Online Store for Your Business',
        'Sell Online Across India',
        'Launch Your Store in Minutes',
        'Orders, Payments and Delivery',
        'Your Own Branded Store',
        'Set Up Your Store Today',
        'Jeffi Commerce',
      ],
      descriptions: [
        'Launch your own online store with payments, delivery and a simple admin. Sign up today.',
        'Sell to customers across India with your own store, catalogue and checkout. Start today.',
        'Run products, orders and messaging from one place. Create your store on Jeffi Commerce.',
      ],
      path1: 'online-store',
      path2: 'india',
      finalUrl: utmUrl(origin, '/', 'ecom_store'),
    },
    {
      ...base,
      id: 'ecom_showcase',
      label: 'Free business website (Showcase)',
      blurb: 'Search ads for small businesses wanting a website. Lands on the pricing page, where Showcase is offered.',
      name: 'Ecom - Showcase website',
      dailyBudget: 300,
      adGroupName: 'Business website',
      keywords: [
        ...kw(['free business website', 'create business website', 'one page website for business', 'small business website india'], 'EXACT'),
        ...kw(['website for my business', 'business website builder', 'make a website for my shop', 'simple website for small business'], 'PHRASE'),
      ],
      negatives: kw([...COMMON_NEGATIVES, 'web hosting', 'domain name only', 'portfolio template', 'personal website'], 'PHRASE'),
      headlines: [
        'Business Website, Free Trial',
        'Website for Your Business',
        'One-Page Site in Minutes',
        'Get Found Online Today',
        'Showcase Your Business',
        'Enquiries Straight to You',
        'Make Your Site Today',
        'Jeffi Showcase',
      ],
      descriptions: [
        'Make a one-page website with your work, reviews and contact details. Free trial.',
        'Get customers to find and contact you online. Build your Showcase site in minutes.',
        'No design skills needed. Add your details and go live. Enquiries come straight to you.',
      ],
      path1: 'website',
      path2: 'free-trial',
      finalUrl: utmUrl(origin, '/pricing', 'ecom_showcase'),
    },
  ]
}

/** The CampaignSpec an unedited preset sends: one Search ad group, created paused. */
export function presetSpec(p: EcomPreset): CampaignSpec {
  return {
    type: 'SEARCH',
    name: p.name,
    dailyBudget: p.dailyBudget,
    bidding: { strategy: 'MAXIMIZE_CONVERSIONS', targetCpa: null, targetRoas: null },
    status: 'PAUSED',
    startDate: null,
    endDate: null,
    locations: p.locations,
    excludedLocations: [],
    languages: p.languages,
    schedule: null,
    networks: { searchPartners: false, display: false },
    adGroups: [
      {
        name: p.adGroupName,
        cpcBid: null,
        keywords: p.keywords,
        negatives: p.negatives,
        ad: { headlines: p.headlines, descriptions: p.descriptions, path1: p.path1, path2: p.path2, finalUrl: p.finalUrl },
      },
    ],
  }
}
