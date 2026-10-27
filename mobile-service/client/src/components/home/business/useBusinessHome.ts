import { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBusinessHome, type BusinessHomeParams, type BusinessHomePart } from '../../../api/business'
import { useBusiness } from '../../account/hooks'
import type { BusinessSectionData, HomeData, HomeSection, SectionType } from '../../../types/home'

// The business sections' data is the signed-in business's own: one GET /api/business/home for the whole page.

const PART: Partial<Record<SectionType, BusinessHomePart>> = {
  business_reorder: 'reorder',
  business_quotes: 'quotes',
  business_offers: 'offers',
  business_account: 'account',
}

export const businessSettings = (section: HomeSection, data: HomeData) => (data.extras[section.id] as BusinessSectionData | null | undefined) ?? null

/** Everything the page's business sections need, the largest limits winning; null when it has none. */
export function businessHomeParams(sections: HomeSection[], data: HomeData): BusinessHomeParams | null {
  const parts = new Set<BusinessHomePart>()
  const offers: string[] = []
  let reorderLimit = 0
  let quotesLimit = 0
  for (const s of sections) {
    const part = PART[s.type]
    if (!part) continue
    parts.add(part)
    const limit = businessSettings(s, data)?.limit ?? 0
    if (part === 'offers') offers.push(s.id)
    if (part === 'reorder') reorderLimit = Math.max(reorderLimit, limit || 8)
    if (part === 'quotes') quotesLimit = Math.max(quotesLimit, limit || 3)
  }
  if (parts.size === 0) return null
  return { sections: [...parts].sort(), offers, reorderLimit: reorderLimit || 8, quotesLimit: quotesLimit || 3 }
}

/** The home screen's request, so its sections share one fetch; a section outside it asks for itself. */
export const BusinessHomeContext = createContext<BusinessHomeParams | null>(null)

export function useBusinessHome(section: HomeSection, data: HomeData) {
  const page = useContext(BusinessHomeContext)
  const params = page ?? businessHomeParams([section], data)
  const { approved, profile } = useBusiness()
  // Visitors and pending accounts get a 401/403, so the sections stay hidden.
  return useQuery({
    queryKey: ['business-home', profile?.id ?? null, params],
    queryFn: () => getBusinessHome(params!),
    enabled: approved && !!params,
    retry: false,
    staleTime: 60_000,
  })
}
