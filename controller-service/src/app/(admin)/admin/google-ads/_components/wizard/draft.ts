import type { WizardBootstrap } from '@/lib/google-ads/manage-data'
import {
  DAYS,
  INDIA,
  filled,
  type BidStrategy,
  type CampaignSpec,
  type CampaignType,
  type Day,
  type KeywordSpec,
  type ListingDimension,
  type MatchType,
} from '@/lib/google-ads/campaign-spec'
import { cleanKeyword } from '@/lib/google-ads/limits'
import { toExtensions, type ExtDraft } from './ExtensionsEditor'

// The wizard's form state (strings for inputs) and its conversion to the CampaignSpec the server takes.

export interface DraftAdGroup {
  key: string
  name: string
  categoryId: string
  cpcBid: string
  keywords: KeywordSpec[]
  negatives: string
  headlines: string[]
  descriptions: string[]
  path1: string
  path2: string
  finalUrl: string
}

export interface Draft {
  type: CampaignType
  name: string
  dailyBudget: string
  strategy: BidStrategy
  targetCpa: string
  /** Percent, as Google shows it (400 = 4x). */
  targetRoas: string
  status: 'PAUSED' | 'ENABLED'
  startDate: string
  endDate: string
  locations: { id: string; name: string }[]
  languages: string[]
  scheduleOn: boolean
  days: Day[]
  startHour: number
  endHour: number
  searchPartners: boolean
  display: boolean
  devices: { mobile: string; desktop: string; tablet: string }
  defaultCpc: string
  adGroups: DraftAdGroup[]
  campaignNegatives: string
  listingDimension: ListingDimension
  listingValues: string[]
  assetGroup: {
    name: string
    finalUrl: string
    feedOnly: boolean
    headlines: string[]
    longHeadlines: string[]
    descriptions: string[]
    businessName: string
    imageIds: string[]
    useStoreLogo: boolean
  }
}

let seq = 0
export const newAdGroup = (baseUrl: string, name = ''): DraftAdGroup => ({
  key: `ag${++seq}`,
  name,
  categoryId: '',
  cpcBid: '',
  keywords: [],
  negatives: '',
  headlines: ['', '', ''],
  descriptions: ['', ''],
  path1: '',
  path2: '',
  finalUrl: baseUrl,
})

export function newDraft(b: WizardBootstrap): Draft {
  return {
    type: 'SEARCH',
    name: '',
    dailyBudget: String(b.budget.suggestedDaily),
    strategy: 'MAXIMIZE_CONVERSIONS',
    targetCpa: '',
    targetRoas: '',
    status: 'PAUSED',
    startDate: '',
    endDate: '',
    locations: b.shipTo.allIndia ? [INDIA] : [],
    languages: ['languageConstants/1000'],
    scheduleOn: false,
    days: [...DAYS],
    startHour: 8,
    endHour: 22,
    searchPartners: false,
    display: false,
    devices: { mobile: '', desktop: '', tablet: '' },
    defaultCpc: '',
    adGroups: [newAdGroup(b.store.baseUrl)],
    campaignNegatives: '',
    listingDimension: 'ALL',
    listingValues: [],
    assetGroup: {
      name: 'All products',
      finalUrl: b.store.baseUrl,
      feedOnly: true,
      headlines: ['', '', ''],
      longHeadlines: [''],
      descriptions: ['', ''],
      businessName: b.store.name,
      imageIds: [],
      useStoreLogo: true,
    },
  }
}

const n = (s: string): number | null => {
  const v = Number(String(s).replace(/,/g, '').trim())
  return s.trim() === '' || !Number.isFinite(v) ? null : v
}

/** One keyword per line; a line may start with [exact] / "phrase" / plain = the default match. */
export function parseKeywordLines(text: string, match: MatchType = 'EXACT'): KeywordSpec[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      if (/^\[.*\]$/.test(l)) return { text: cleanKeyword(l.slice(1, -1)), matchType: 'EXACT' as MatchType }
      if (/^".*"$/.test(l)) return { text: cleanKeyword(l.slice(1, -1)), matchType: 'PHRASE' as MatchType }
      return { text: cleanKeyword(l), matchType: match }
    })
    .filter(k => k.text)
}

export function toSpec(d: Draft, ext: ExtDraft | null): CampaignSpec {
  const roas = n(d.targetRoas)
  const devices = { mobile: n(d.devices.mobile), desktop: n(d.devices.desktop), tablet: n(d.devices.tablet) }
  return {
    type: d.type,
    name: d.name.trim(),
    dailyBudget: n(d.dailyBudget) ?? 0,
    bidding: {
      strategy: d.strategy,
      targetCpa: d.strategy === 'MAXIMIZE_CONVERSIONS' ? n(d.targetCpa) : null,
      targetRoas: d.strategy === 'MAXIMIZE_CONVERSION_VALUE' && roas ? roas / 100 : null,
    },
    status: d.status,
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    locations: d.locations,
    excludedLocations: [],
    languages: d.languages,
    schedule: d.scheduleOn ? { days: d.days, startHour: d.startHour, endHour: d.endHour } : null,
    networks: { searchPartners: d.searchPartners, display: d.type === 'SEARCH' && d.display },
    devices: d.type === 'PERFORMANCE_MAX' ? undefined : devices,
    defaultCpc: n(d.defaultCpc),
    adGroups:
      d.type === 'SEARCH'
        ? d.adGroups.map(g => ({
            name: g.name.trim() || 'Ad group',
            cpcBid: n(g.cpcBid),
            keywords: g.keywords,
            negatives: parseKeywordLines(g.negatives, 'PHRASE'),
            ad: { headlines: filled(g.headlines), descriptions: filled(g.descriptions), path1: g.path1.trim(), path2: g.path2.trim(), finalUrl: g.finalUrl.trim() },
          }))
        : undefined,
    campaignNegatives: d.type === 'PERFORMANCE_MAX' ? undefined : parseKeywordLines(d.campaignNegatives, 'PHRASE'),
    listing: d.type === 'SEARCH' ? undefined : { dimension: d.listingDimension, values: d.listingDimension === 'ALL' ? [] : d.listingValues },
    assetGroup:
      d.type === 'PERFORMANCE_MAX'
        ? {
            ...d.assetGroup,
            name: d.assetGroup.name.trim() || 'All products',
            headlines: filled(d.assetGroup.headlines),
            longHeadlines: filled(d.assetGroup.longHeadlines),
            descriptions: filled(d.assetGroup.descriptions),
          }
        : undefined,
    extensions: ext ? toExtensions(ext) : undefined,
  }
}
