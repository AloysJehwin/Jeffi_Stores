// Pexels photo search: GET https://api.pexels.com/v1/search?query=…&orientation=…&per_page=…, header
// `Authorization: <key>`. Copying the file is allowed; the API asks for a link to Pexels and a photographer credit.
// No safe-search flag (queries stay on places and objects) and no AI uploads. The original is served resized
// through its own `?w=` parameter.

import type { StockImage, StockProvider, StockQuery } from './types'
import { fetchJson } from './types'

const BASE = 'https://api.pexels.com/v1/search'
const MAX_WIDTH = 1920

interface PexelsPhoto {
  id?: number
  width?: number
  height?: number
  url?: string
  photographer?: string
  photographer_url?: string
  alt?: string
  src?: { original?: string }
}

export function parsePexels(json: unknown): StockImage[] {
  const photos = (json as { photos?: PexelsPhoto[] } | null)?.photos
  if (!Array.isArray(photos)) return []
  const out: StockImage[] = []
  for (const p of photos) {
    const original = p?.src?.original
    if (!p?.id || !original || !p.url || !p.width || !p.height) continue
    const width = Math.min(p.width, MAX_WIDTH)
    const u = new URL(original)
    u.search = new URLSearchParams({ auto: 'compress', cs: 'tinysrgb', w: String(width) }).toString()
    out.push({
      provider: 'pexels',
      id: String(p.id),
      url: u.toString(),
      width,
      height: Math.round((p.height * width) / p.width),
      alt: (p.alt ?? '').trim().slice(0, 200),
      photographer: (p.photographer ?? '').trim() || 'Pexels',
      photographerUrl: p.photographer_url || null,
      pageUrl: p.url,
    })
  }
  return out
}

export class PexelsProvider implements StockProvider {
  readonly name = 'pexels' as const
  constructor(
    private readonly key = process.env.PEXELS_API_KEY || '',
    private readonly timeoutMs = Number(process.env.STOCK_TIMEOUT_MS) || 15_000,
  ) {}

  configured(): boolean { return !!this.key }

  async search(q: StockQuery): Promise<StockImage[]> {
    const params = new URLSearchParams({ query: q.query.slice(0, 100), orientation: q.orientation, per_page: String(Math.max(1, Math.min(80, q.perPage))) })
    return parsePexels(await fetchJson('pexels', `${BASE}?${params}`, { headers: { Authorization: this.key }, timeoutMs: this.timeoutMs }))
  }
}

export const pexelsProvider = new PexelsProvider()
