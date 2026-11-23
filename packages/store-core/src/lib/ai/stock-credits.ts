// Credits for stock photos (Pexels, Pixabay; docs/plans/STOCK_IMAGES.md). Pure, so the site renderers, the Showcase
// content cleaner and the server helpers read one shape.

export type StockSource = 'pexels' | 'pixabay'

/** Who took a stock photo and where it came from; the footer credits line links both. */
export interface StockCredit {
  /** The photographer's name. */
  name: string
  /** Their profile page, when the library gives one. */
  url: string | null
  source: StockSource
  /** The photo's own page on the library. */
  pageUrl: string
}

export const STOCK_SOURCES: Record<StockSource, { label: string; url: string }> = {
  pexels: { label: 'Pexels', url: 'https://www.pexels.com' },
  pixabay: { label: 'Pixabay', url: 'https://pixabay.com' },
}

const HTTPS = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s<>"'`\\]*)?$/i
const https = (v: unknown) => (typeof v === 'string' && v.length <= 1000 && HTTPS.test(v.trim()) ? v.trim() : null)

/** A credit as stored or posted, checked: a known library, a name and https links only; else null. */
export function cleanStockCredit(v: unknown): StockCredit | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  const source = c.source === 'pexels' || c.source === 'pixabay' ? c.source : null
  const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  const pageUrl = https(c.pageUrl)
  if (!source || !name || !pageUrl) return null
  return { name, url: https(c.url), source, pageUrl }
}

/** A stock file copied into a bucket keeps its library and id in the key (lib/ai/stock.ts). */
export const STOCK_KEY = /\/stock\/(pexels|pixabay)-[A-Za-z0-9]+\.[a-z]+(?:[?#]|$)/

/** The picture is still the stock file it was credited for (an owner's replacement drops the credit). */
export const isStockImageUrl = (url: unknown) => typeof url === 'string' && STOCK_KEY.test(url)

/** The credits of the pictures that are still stock files (a Showcase's content.pictures). */
export const pictureCredits = (pictures: { image?: unknown; credit?: unknown }[] | null | undefined): StockCredit[] =>
  (pictures ?? []).filter(p => isStockImageUrl(p?.image)).map(p => cleanStockCredit(p.credit)).filter((c): c is StockCredit => !!c)

/** site_settings key: credits by image URL for stock photos outside the gallery (a seeded sample catalogue's). */
export const STOCK_CREDITS_SETTING = 'stock_photo_credits'

export interface CreditGroup {
  source: StockSource
  label: string
  url: string
  people: { name: string; url: string }[]
}

const MAX_PEOPLE = 8

/** Credits grouped by library (Pexels first), each photographer once, linked to their profile or the photo. */
export function creditGroups(credits: (StockCredit | null | undefined)[]): CreditGroup[] {
  const groups = new Map<StockSource, CreditGroup>()
  for (const raw of credits) {
    const c = cleanStockCredit(raw)
    if (!c) continue
    const g = groups.get(c.source) ?? { source: c.source, ...STOCK_SOURCES[c.source], people: [] }
    groups.set(c.source, g)
    if (g.people.length < MAX_PEOPLE && !g.people.some(p => p.name.toLowerCase() === c.name.toLowerCase())) g.people.push({ name: c.name, url: c.url ?? c.pageUrl })
  }
  return (['pexels', 'pixabay'] as const).map(s => groups.get(s)).filter((g): g is CreditGroup => !!g)
}
