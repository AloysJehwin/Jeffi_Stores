import { businessSectionPublic, type HomepageSection } from '@/lib/catalog/homepage-sections'
import type { CardProps } from '@/lib/catalog/product-card-props'

/** What a business section needs from its row; plain values only, so it can cross to the client. */
export type BusinessSection = Pick<
  HomepageSection,
  'id' | 'type' | 'title' | 'subtitle' | 'eyebrow' | 'cta_label' | 'cta_url' | 'config'
>

export const toBusinessSection = (s: HomepageSection): BusinessSection => ({
  id: s.id,
  type: s.type,
  title: s.title,
  subtitle: s.subtitle,
  eyebrow: s.eyebrow,
  cta_label: s.cta_label,
  cta_url: s.cta_url,
  config: s.config,
})

export interface BusinessQuoteItem {
  id: string
  rfqNumber: string
  status: string
  itemCount: number
  createdAt: string
}

export interface BusinessOrderItem {
  id: string
  orderNumber: string
  status: string
  total: number
  createdAt: string
}

/** GET /api/business/home's response. */
export interface BusinessHomeData {
  company: { name: string | null; gstNumber: string | null }
  reorder?: CardProps[]
  quotes?: { open: number; items: BusinessQuoteItem[] }
  account?: { recentOrders: BusinessOrderItem[]; paymentsDue: { count: number; total: number } }
  offers?: Record<string, CardProps[]>
}

/** The /api/business/home query for the page's business sections; null when there are none. */
export function businessHomeQuery(sections: Pick<HomepageSection, 'id' | 'type' | 'config'>[]): string | null {
  const want = new Set<string>()
  const offers: string[] = []
  const params = new URLSearchParams()
  for (const s of sections) {
    const pub = businessSectionPublic(s)
    if (!pub) continue
    if (s.type === 'business_reorder') {
      want.add('reorder')
      params.set('reorderLimit', String(pub.limit))
    } else if (s.type === 'business_quotes') {
      want.add('quotes')
      params.set('quotesLimit', String(pub.limit))
    } else if (s.type === 'business_offers') {
      want.add('offers')
      offers.push(s.id)
    } else if (s.type === 'business_account') {
      want.add('account')
    }
  }
  if (want.size === 0) return null
  params.set('sections', [...want].join(','))
  if (offers.length > 0) params.set('offers', offers.join(','))
  return params.toString()
}
