import { queryMany } from '@/lib/shared/db'
import type { GoogleAdsClient } from './client'

// Location targeting: Google's geo target suggestions, and the states the store ships to (its
// active shipping zones) resolved to geoTargetConstants.

export interface GeoOption {
  id: string
  name: string
  type: string | null
  canonicalName: string | null
  reach: number | null
  searchTerm?: string | null
}

const STATE_TYPES = new Set(['State', 'Union Territory', 'Territory', 'Province'])

function toOption(s: any): GeoOption | null {
  const g = s?.geoTargetConstant
  if (!g?.resourceName || g.status === 'REMOVAL_PLANNED') return null
  return {
    id: String(g.resourceName),
    name: String(g.name ?? ''),
    type: g.targetType ?? null,
    canonicalName: g.canonicalName ?? null,
    reach: s.reach == null ? null : Number(s.reach),
    searchTerm: s.searchTerm ?? null,
  }
}

async function suggest(ads: GoogleAdsClient, names: string[], countryCode: string): Promise<GeoOption[]> {
  const res = await ads.request<any>('POST', '/geoTargetConstants:suggest', {
    locale: 'en',
    countryCode,
    locationNames: { names },
  })
  return (res?.geoTargetConstantSuggestions ?? []).map(toOption).filter((o: GeoOption | null): o is GeoOption => !!o)
}

/** States, cities and regions matching a typed name (one country). */
export async function suggestGeo(ads: GoogleAdsClient, query: string, countryCode = 'IN'): Promise<GeoOption[]> {
  const q = query.trim().slice(0, 80)
  if (q.length < 2) return []
  return (await suggest(ads, [q], countryCode)).slice(0, 15)
}

/** Resolve state names to their state-level geo targets; names Google does not match come back unresolved. */
export async function resolveStateNames(
  ads: GoogleAdsClient,
  names: string[],
  countryCode = 'IN'
): Promise<{ resolved: GeoOption[]; unresolved: string[] }> {
  const wanted = [...new Set(names.map(n => n.trim()).filter(Boolean))].slice(0, 50)
  if (!wanted.length) return { resolved: [], unresolved: [] }
  const all = await suggest(ads, wanted, countryCode)
  const resolved: GeoOption[] = []
  const unresolved: string[] = []
  for (const name of wanted) {
    const mine = all.filter(o => (o.searchTerm ?? '').toLowerCase() === name.toLowerCase())
    const pool = mine.length ? mine : all.filter(o => o.name.toLowerCase() === name.toLowerCase())
    const best = pool.find(o => o.type && STATE_TYPES.has(o.type) && o.name.toLowerCase() === name.toLowerCase()) ?? pool.find(o => o.type && STATE_TYPES.has(o.type))
    if (best && !resolved.some(r => r.id === best.id)) resolved.push(best)
    else if (!best) unresolved.push(name)
  }
  return { resolved, unresolved }
}

/** Distinct states across the store's active shipping zones; empty when no zone lists states. */
export async function shipToStates(): Promise<string[]> {
  const rows = await queryMany<{ state: string }>(
    `SELECT DISTINCT trim(s) AS state
     FROM shipping_zones z, jsonb_array_elements_text(CASE WHEN jsonb_typeof(z.states) = 'array' THEN z.states ELSE '[]'::jsonb END) s
     WHERE z.is_active IS NOT FALSE AND trim(s) <> ''
     ORDER BY 1`
  ).catch(() => [])
  return rows.map(r => r.state)
}

/** India's 28 states and 8 union territories: a zone set covering all of them is just "India". */
export const INDIA_REGION_COUNT = 36
