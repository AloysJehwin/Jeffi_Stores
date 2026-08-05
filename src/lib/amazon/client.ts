// Amazon SP-API client — mirrors src/lib/merchant/client.ts (Google Merchant).
// Env-driven so flipping sandbox -> production is purely an env-var swap (host + LWA creds),
// with no code change. Modern SP-API for Listings/Feeds/Catalog needs ONLY the 3 LWA values;
// no AWS SigV4/IAM signing is required.

// SP-API host is environment-driven; defaults to the EU sandbox.
const SP_API_HOST = process.env.AMAZON_SP_API_HOST || 'https://sandbox.sellingpartnerapi-eu.amazon.com'
// Marketplace defaults to amazon.in.
export const MARKETPLACE_ID = process.env.AMAZON_MARKETPLACE_ID || 'A21TJRUUN4KGV'
// Seller (merchant) id — path param for the Listings Items API.
export const SELLER_ID = process.env.AMAZON_SELLER_ID || ''
// When true (set on local dev), pushes to Amazon are refused so local never writes to a
// real Amazon account (mirrors GMC_PUSH_DISABLED).
export const AMAZON_PUSH_DISABLED = process.env.AMAZON_PUSH_DISABLED === 'true'

// LWA token endpoint is global (not region-specific).
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const LISTINGS_BASE = '/listings/2021-08-01/items'
const CATALOG_BASE = '/catalog/2022-04-01/items'
const RESTRICTIONS_BASE = '/listings/2021-08-01/restrictions'

interface LwaCreds {
  clientId: string
  clientSecret: string
  refreshToken: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function loadCredentials(): LwaCreds {
  return {
    clientId: process.env.AMAZON_LWA_CLIENT_ID || '',
    clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || '',
    refreshToken: process.env.AMAZON_LWA_REFRESH_TOKEN || '',
  }
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token
  }

  const creds = loadCredentials()
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    throw new Error('Amazon LWA credentials missing (AMAZON_LWA_CLIENT_ID/SECRET/REFRESH_TOKEN)')
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  })

  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Amazon LWA auth failed: ' + JSON.stringify(data))
  }

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

interface SpApiOptions {
  query?: Record<string, string | undefined>
  body?: unknown
}

// Generic SP-API request helper (mirror of gmcRequest). SP-API authenticates via the
// x-amz-access-token header, NOT Authorization: Bearer.
export async function spApiRequest(method: string, path: string, opts: SpApiOptions = {}): Promise<any> {
  const token = await getAccessToken()

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined && v !== '') params.set(k, v)
  }
  const qs = params.toString()
  const url = `${SP_API_HOST}${path}${qs ? `?${qs}` : ''}`

  const res = await fetch(url, {
    method,
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })

  if (!res.ok) {
    const err = await res.text()
    const rateLimit = res.headers.get('x-amzn-RateLimit-Limit') || ''
    const e: any = new Error(`Amazon ${method} ${path} failed (${res.status}): ${err}`)
    e.status = res.status
    e.retryAfter = res.headers.get('Retry-After') || ''
    e.rateLimit = rateLimit
    throw e
  }

  if (res.status === 204) return null
  return res.json()
}

// --- Listings Items API operation wrappers ---

function itemPath(sku: string): string {
  return `${LISTINGS_BASE}/${encodeURIComponent(SELLER_ID)}/${encodeURIComponent(sku)}`
}

// Create/replace a listing for one SKU. `listing` is { productType, requirements, attributes }.
export async function putListingsItem(sku: string, listing: unknown): Promise<any> {
  return spApiRequest('PUT', itemPath(sku), {
    query: { marketplaceIds: MARKETPLACE_ID },
    body: listing,
  })
}

// Targeted JSON-Patch update of specific attributes (e.g. purchasable_offer, fulfillment_
// availability). Amazon recommends patch (not a bundled PUT) for offer/availability — a bundled
// offer-only PUT can silently drop purchasable_offer, leaving the listing DISCOVERABLE-not-BUYABLE.
export async function patchListingsItem(
  sku: string,
  productType: string,
  patches: Array<{ op: 'add' | 'replace' | 'delete' | 'merge'; path: string; value?: unknown }>,
): Promise<any> {
  return spApiRequest('PATCH', itemPath(sku), {
    query: { marketplaceIds: MARKETPLACE_ID },
    body: { productType, patches },
  })
}

// Validate a listing against Amazon's productType schema WITHOUT publishing it. Returns the
// same shape as a real PUT (status + issues[]), so we can preview mapper correctness safely.
export async function validateListingsItem(sku: string, listing: unknown): Promise<any> {
  return spApiRequest('PUT', itemPath(sku), {
    query: { marketplaceIds: MARKETPLACE_ID, mode: 'VALIDATION_PREVIEW' },
    body: listing,
  })
}

// Delete a listing for one SKU. Tolerates 404 (already absent), like GMC deleteProduct.
export async function deleteListingsItem(sku: string): Promise<void> {
  try {
    await spApiRequest('DELETE', itemPath(sku), { query: { marketplaceIds: MARKETPLACE_ID } })
  } catch (err: any) {
    if (err?.status !== 404) throw err
  }
}

// Read a single listing with its status summaries + issues.
export async function getListingsItem(sku: string): Promise<any> {
  return spApiRequest('GET', itemPath(sku), {
    query: { marketplaceIds: MARKETPLACE_ID, includedData: 'summaries,issues,attributes' },
  })
}

// Paginated read of our own listings (analog of GMC listProductStatuses).
export async function searchListingsItems(pageToken?: string): Promise<{ items?: any[]; pagination?: { nextToken?: string } }> {
  return spApiRequest('GET', `${LISTINGS_BASE}/${encodeURIComponent(SELLER_ID)}`, {
    query: {
      marketplaceIds: MARKETPLACE_ID,
      includedData: 'summaries,issues',
      pageSize: '20',
      pageToken,
    },
  })
}

// --- Catalog Items API 2022-04-01 (find EXISTING ASINs to attach offers to) ---

export interface CatalogMatch {
  asin: string
  title?: string
  brand?: string
}

export async function searchCatalogItems(params: {
  keywords?: string
  identifiers?: string
  identifiersType?: 'ASIN' | 'EAN' | 'GTIN' | 'UPC' | 'ISBN' | 'JAN' | 'MINSAN'
  brandNames?: string
  pageSize?: number
}): Promise<{ items?: any[]; numberOfResults?: number }> {
  return spApiRequest('GET', CATALOG_BASE, {
    query: {
      marketplaceIds: MARKETPLACE_ID,
      includedData: 'identifiers,summaries',
      keywords: params.keywords,
      identifiers: params.identifiers,
      identifiersType: params.identifiers ? params.identifiersType : undefined,
      brandNames: params.brandNames,
      pageSize: String(params.pageSize ?? 10),
    },
  })
}

function toCatalogMatch(item: any): CatalogMatch {
  const s = (item?.summaries || []).find((x: any) => x.marketplaceId === MARKETPLACE_ID) || item?.summaries?.[0]
  return { asin: item?.asin, title: s?.itemName, brand: s?.brand || s?.brandName }
}

// Distinguishing spec tokens for fasteners/tools: metric size (M12), dimensions (16mm / 16 mm),
// inch fractions (1/2"), and product-TYPE words (the item kind). Both size AND type must agree,
// because e.g. a Dowel Pin M4 and a Button Screw M4 share the size but are different products.
const TYPE_WORDS = [
  'bolt', 'screw', 'nut', 'washer', 'dowel', 'pin', 'stud', 'rivet', 'anchor',
  'socket', 'cap', 'button', 'countersunk', 'csk', 'grub', 'set', 'hex', 'allen',
  'lock', 'nyloc', 'flange', 'wrench', 'spanner', 'driver', 'drill', 'level',
  'lug', 'terminal', 'durlok', 'shcs', 'taper',
]

function extractSpecTokens(text: string): { sizes: Set<string>; dims: Set<string>; types: Set<string>; models: Set<string>; packs: Set<string> } {
  const t = ` ${(text || '').toLowerCase()} `
  const sizes = new Set<string>()
  const dims = new Set<string>()
  const types = new Set<string>()
  const models = new Set<string>()
  const packs = new Set<string>()
  for (const m of t.matchAll(/\bm\s?(\d{1,3})\b/g)) sizes.add(`m${m[1]}`)
  for (const m of t.matchAll(/\b(\d{1,4})\s?mm\b/g)) dims.add(`${m[1]}mm`)
  for (const m of t.matchAll(/\b(\d+\/\d+)\s?"?/g)) dims.add(m[1])
  for (const w of TYPE_WORDS) if (t.includes(` ${w}`)) types.add(w)
  // Model codes: alnum tokens with both letters+digits (KM9V, BS31, DIN980M, 1013) — strong
  // discriminators between otherwise-similar sets. Also bare 3-4 digit model numbers.
  for (const m of t.matchAll(/\b([a-z]{2,4}\s?\d{1,4}[a-z]?)\b/g)) models.add(m[1].replace(/\s/g, ''))
  // Pack/set counts: "13pc", "200 pcs", "set of 9", "9 pc".
  for (const m of t.matchAll(/\b(\d{1,4})\s?(?:pc|pcs|piece|pieces)\b/g)) packs.add(`${m[1]}pc`)
  for (const m of t.matchAll(/\bset of\s?(\d{1,4})\b/g)) packs.add(`${m[1]}pc`)
  return { sizes, dims, types, models, packs }
}

// Score a candidate. HARD-REJECT (-1) unless the strong discriminators agree: metric size,
// product type, AND — when present — model code and pack count. This stops different fasteners
// of the same size, or a 13-piece set matching a 9-piece set, from collapsing onto one ASIN.
function scoreCandidate(ourName: string, candidateTitle: string): number {
  const a = extractSpecTokens(ourName)
  const b = extractSpecTokens(candidateTitle)

  if (a.sizes.size && ![...a.sizes].some(s => b.sizes.has(s))) return -1
  if (a.types.size && ![...a.types].some(x => b.types.has(x))) return -1
  // If our name carries a model code, the candidate MUST share one (KM13V != KM9V).
  if (a.models.size && b.models.size && ![...a.models].some(x => b.models.has(x))) return -1
  // If both carry a pack count, they must agree (13pc != 9pc).
  if (a.packs.size && b.packs.size && ![...a.packs].some(x => b.packs.has(x))) return -1

  let score = 0
  for (const s of a.sizes) if (b.sizes.has(s)) score += 3
  for (const x of a.models) if (b.models.has(x)) score += 4
  for (const x of a.packs) if (b.packs.has(x)) score += 3
  for (const d of a.dims) if (b.dims.has(d)) score += 2
  for (const x of a.types) if (b.types.has(x)) score += 1
  return score
}

// Best-effort ASIN match for one of our products/variants:
//  1) exact GTIN lookup (highest confidence)
//  2) brand + keyword search, then require brand equality AND spec-token (size) agreement,
//     picking the highest-scoring candidate. Returns null when nothing confident matches
//     (caller falls back to full-create) — this prevents wrong-detail-page attachment.
export async function matchAsin(input: {
  gtin?: string
  brand?: string
  mpn?: string
  name: string
}): Promise<CatalogMatch | null> {
  const rawGtin = String(input.gtin || '').replace(/\D/g, '')
  if (rawGtin.length >= 12) {
    const type = rawGtin.length === 12 ? 'UPC' : 'EAN'
    const res = await searchCatalogItems({ identifiers: rawGtin, identifiersType: type })
    const hit = res.items?.[0]
    if (hit?.asin) return toCatalogMatch(hit)
  }

  const kw = [input.mpn, input.name].filter(Boolean).join(' ').slice(0, 200)
  if (!kw) return null
  const res = await searchCatalogItems({ keywords: kw, brandNames: input.brand || undefined, pageSize: 20 })
  const brandLc = (input.brand || '').toLowerCase().trim()

  let best: CatalogMatch | null = null
  let bestScore = 0 // require a strictly positive score → at least one spec token agreed
  for (const item of res.items || []) {
    const m = toCatalogMatch(item)
    if (!m.asin) continue
    if (brandLc && (m.brand || '').toLowerCase().trim() !== brandLc) continue
    const score = scoreCandidate(input.name, m.title || '')
    if (score > bestScore) { bestScore = score; best = m }
  }
  return best
}

// Brand-gate check: whether we're allowed to create an offer on an ASIN. Empty restrictions
// array => listable now; entries => approval required (with a reasonCode / approval link).
export async function getListingsRestrictions(asin: string, conditionType = 'new_new'): Promise<{ restrictions?: any[] }> {
  return spApiRequest('GET', RESTRICTIONS_BASE, {
    query: {
      asin,
      conditionType,
      sellerId: SELLER_ID,
      marketplaceIds: MARKETPLACE_ID,
    },
  })
}
