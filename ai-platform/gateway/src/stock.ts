// POST /v1/images/stock: keyword search over free photo libraries, in AI_STOCK_PROVIDERS order (default pexels,
// pixabay). A provider without a key is skipped; the first one with a usable hit answers. No key, no hits or every
// provider failing all answer 200 with no results, so the app falls back to AI generation. Each provider's hits are
// cached in Redis for 24 h by provider, query and orientation (Pixabay's caching rule, and one quota for all stores).

import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { StockImage, StockOrientation, StockProviderName, StockSearchRequest, StockSearchResponse } from '../../sdk/types'
import { ValidationError, parseRequestedProviders } from './media'
import type { StockProvider } from './providers/types'

export const STOCK_PROVIDER_ORDER: StockProviderName[] = ['pexels', 'pixabay']
const STOCK_PROVIDER_SET = new Set<StockProviderName>(STOCK_PROVIDER_ORDER)
const ORIENTATIONS = new Set<StockOrientation>(['landscape', 'portrait', 'square'])
/** What is fetched and cached per provider; `perPage` trims the answer. */
const FETCH_PER_PAGE = 30
export const STOCK_CACHE_TTL_SEC = 24 * 3600

export interface StockDeps {
  providers: Partial<Record<StockProviderName, StockProvider>>
  order: StockProviderName[]
  redis?: Pick<Redis, 'get' | 'set'> | null
  ttlSec?: number
}

export interface ParsedStockReq {
  query: string
  orientation: StockOrientation
  minWidth: number
  perPage: number
  providers?: StockProviderName[]
}

export function parseStockProviders(raw: string | undefined): StockProviderName[] {
  const out = (raw ?? '').split(',').map(p => p.trim()).filter((p, i, all): p is StockProviderName => STOCK_PROVIDER_SET.has(p as StockProviderName) && all.indexOf(p) === i)
  return out.length ? out : STOCK_PROVIDER_ORDER
}

export function parseStockRequest(raw: unknown): ParsedStockReq {
  const r = (raw ?? {}) as Partial<StockSearchRequest>
  const query = typeof r.query === 'string' ? r.query.toLowerCase().replace(/[^\p{L}\p{N}\s'&-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) : ''
  if (!query) throw new ValidationError('query is required')
  const orientation = ORIENTATIONS.has(r.orientation as StockOrientation) ? (r.orientation as StockOrientation) : 'landscape'
  const minWidth = Math.max(0, Math.min(4000, Math.floor(Number(r.minWidth) || 0)))
  const perPage = Math.max(1, Math.min(FETCH_PER_PAGE, Math.floor(Number(r.perPage) || 15)))
  return { query, orientation, minWidth, perPage, providers: parseRequestedProviders(r.providers, STOCK_PROVIDER_SET, 'stock') }
}

export function stockCacheKey(provider: StockProviderName, query: string, orientation: StockOrientation): string {
  return `ai:stock:${provider}:` + createHash('sha256').update(JSON.stringify({ query, orientation })).digest('hex')
}

async function readCache(redis: StockDeps['redis'], key: string): Promise<StockImage[] | null> {
  const raw = redis ? await redis.get(key).catch(() => null) : null
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

export async function handleStockSearch(body: unknown, deps: StockDeps): Promise<StockSearchResponse> {
  const p = parseStockRequest(body)
  const route = (p.providers ?? deps.order).filter(n => deps.providers[n]?.configured())
  const tried: { provider: string; error: string }[] = []
  for (const name of route) {
    const key = stockCacheKey(name, p.query, p.orientation)
    let hits = await readCache(deps.redis, key)
    const cached = !!hits
    if (!hits) {
      try {
        hits = await deps.providers[name]!.search({ query: p.query, orientation: p.orientation, perPage: FETCH_PER_PAGE })
      } catch (err) {
        tried.push({ provider: name, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) })
        continue
      }
      // Empty answers are cached too: the same search would find nothing again within the day.
      await deps.redis?.set(key, JSON.stringify(hits), 'EX', deps.ttlSec ?? STOCK_CACHE_TTL_SEC).catch(() => undefined)
    }
    const results = hits.filter(h => h.width >= p.minWidth).slice(0, p.perPage)
    if (results.length) return { results, provider: name, cache: cached ? 'kv' : null, ...(tried.length ? { tried } : {}) }
  }
  return { results: [], provider: null, cache: null, ...(tried.length ? { tried } : {}) }
}
