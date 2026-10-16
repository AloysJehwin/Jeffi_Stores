import { queryMany, queryOne } from '@/lib/shared/db'
import type { GoogleAdsClient } from './client'
import type { KeywordSpec, MatchType } from './campaign-spec'
import { INDIA } from './campaign-spec'
import { cleanKeyword, keywordProblem } from './limits'
import { OpList, rn, toMicros } from './mutate'

// Keywords and negatives (ad group or campaign level), keyword seeds from the catalogue, and
// Keyword Planner ideas (KeywordPlanIdeaService.GenerateKeywordIdeas).

export function dedupeKeywords(list: KeywordSpec[]): KeywordSpec[] {
  const seen = new Set<string>()
  const out: KeywordSpec[] = []
  for (const k of list) {
    const text = cleanKeyword(k.text)
    const key = `${text}|${k.matchType}`
    if (!text || keywordProblem(text) || seen.has(key)) continue
    seen.add(key)
    out.push({ text, matchType: k.matchType })
  }
  return out
}

export function adGroupKeywordOps(
  adGroup: string,
  keywords: KeywordSpec[],
  opts: { negative?: boolean; cpcBid?: number | null; ops?: OpList; label?: string } = {}
): OpList {
  const ops = opts.ops ?? new OpList()
  for (const k of dedupeKeywords(keywords)) {
    ops.create(
      'adGroupCriterionOperation',
      {
        adGroup,
        status: 'ENABLED',
        ...(opts.negative ? { negative: true } : {}),
        keyword: { text: k.text, matchType: k.matchType },
        ...(!opts.negative && opts.cpcBid ? { cpcBidMicros: toMicros(opts.cpcBid) } : {}),
      },
      `${opts.label ? `${opts.label}: ` : ''}${opts.negative ? 'negative ' : ''}keyword "${k.text}"`
    )
  }
  return ops
}

export function campaignNegativeOps(campaign: string, keywords: KeywordSpec[], ops = new OpList()): OpList {
  for (const k of dedupeKeywords(keywords)) {
    ops.create('campaignCriterionOperation', { campaign, negative: true, keyword: { text: k.text, matchType: k.matchType } }, `Negative keyword "${k.text}"`)
  }
  return ops
}

/** Ad group criterion resource for one keyword, for status changes and removal. */
export const keywordResource = (customerId: string, adGroupId: string, criterionId: string) =>
  rn.adGroupCriterion(customerId, adGroupId, criterionId)

export interface KeywordIdea {
  text: string
  avgMonthlySearches: number | null
  competition: string | null
  lowBid: number | null
  highBid: number | null
}

const n = (v: unknown) => (v == null || v === '' ? null : Number(v))

export async function generateKeywordIdeas(
  ads: GoogleAdsClient,
  opts: { seeds: string[]; url?: string | null; language?: string; locations?: string[]; pageSize?: number }
): Promise<KeywordIdea[]> {
  const keywords = [...new Set(opts.seeds.map(cleanKeyword).filter(Boolean))].slice(0, 20)
  if (!keywords.length && !opts.url) return []
  const seed = opts.url
    ? keywords.length
      ? { keywordAndUrlSeed: { url: opts.url, keywords } }
      : { urlSeed: { url: opts.url } }
    : { keywordSeed: { keywords } }
  const res = await ads.post<any>(':generateKeywordIdeas', {
    language: opts.language || 'languageConstants/1000',
    geoTargetConstants: opts.locations?.length ? opts.locations.slice(0, 10) : [INDIA.id],
    includeAdultKeywords: false,
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    pageSize: Math.max(1, Math.min(100, opts.pageSize ?? 50)),
    ...seed,
  })
  return (res?.results ?? [])
    .map((r: any) => {
      const m = r?.keywordIdeaMetrics ?? {}
      return {
        text: cleanKeyword(String(r?.text ?? '')),
        avgMonthlySearches: n(m.avgMonthlySearches),
        competition: m.competition ?? null,
        lowBid: m.lowTopOfPageBidMicros == null ? null : Number(m.lowTopOfPageBidMicros) / 1e6,
        highBid: m.highTopOfPageBidMicros == null ? null : Number(m.highTopOfPageBidMicros) / 1e6,
      }
    })
    .filter((k: KeywordIdea) => k.text && !keywordProblem(k.text))
}

/** Seed keywords from our own catalogue: the category, its best-selling product names and brands. */
export async function catalogueSeeds(categoryId?: string | null): Promise<{ seeds: string[]; categoryName: string | null }> {
  const cat = categoryId
    ? await queryOne<{ name: string }>(`SELECT name FROM categories WHERE id = $1::uuid`, [categoryId]).catch(() => null)
    : null
  const rows = await queryMany<{ name: string; brand: string | null }>(
    `SELECT p.name, b.name AS brand
     FROM products p
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE p.is_active IS NOT FALSE ${categoryId ? 'AND p.category_id = $1::uuid' : ''}
     ORDER BY COALESCE(p.sales_count, 0) DESC, p.created_at DESC
     LIMIT 15`,
    categoryId ? [categoryId] : []
  ).catch(() => [])
  const seeds = [
    cat?.name ?? null,
    ...rows.map(r => r.name),
    ...rows.map(r => (r.brand && cat?.name ? `${r.brand} ${cat.name}` : null)),
  ]
    .filter((s): s is string => !!s)
    .map(cleanKeyword)
    .filter(s => s && !keywordProblem(s))
  return { seeds: [...new Set(seeds)].slice(0, 25), categoryName: cat?.name ?? null }
}

export const MATCH_LABEL: Record<MatchType, string> = { EXACT: 'Exact', PHRASE: 'Phrase', BROAD: 'Broad' }
