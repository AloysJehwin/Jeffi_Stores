// Real offers from the Razorpay account, replacing the hardcoded bank offers that used to be
// displayed on product pages. Those named HDFC, ICICI, Kotak, SBI and RuPay deals that do not
// exist on this account, so customers were shown discounts they could never receive.
//
// GET /v1/offers is authenticated and merchant-scoped, so it cannot be called from the browser.
// This module fetches it server-side and hands back only display-safe fields.

const OFFERS_URL = 'https://api.razorpay.com/v1/offers?count=100'
const TTL_MS = 15 * 60 * 1000

export interface PublicOffer {
  id: string
  title: string
  methods: string[]
  issuers: string[]
  endsAt: string | null
  terms: string | null
}

interface RawOffer {
  id: string
  name?: string
  display_name?: string
  status?: string
  ends_at?: string | number | null
  terms?: { tnc?: string } | null
  display_config?: { is_hidden?: boolean } | null
  rules?: { items?: Array<{ criteria?: { includes?: { paymentInstrument?: Record<string, any> } } }> } | null
}

let cache: { at: number; offers: PublicOffer[] } | null = null

/** Bank codes Razorpay returns on card rules; unmapped codes fall through unchanged. */
const ISSUER_NAMES: Record<string, string> = {
  HSBC: 'HSBC', INDB: 'IndusInd', UTIB: 'Axis Bank', BARB: 'Bank of Baroda',
  IDFB: 'IDFC First', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', SBIN: 'SBI', KKBK: 'Kotak',
}

/**
 * Some entries on the account are Razorpay partner-visibility deals, not customer discounts —
 * "GPay UPI logo visibility offer", "SalarySe UPI spend stimulation (L1)". They carry the same
 * status, channel and benefits_types as real cashback offers, so there is no structural signal
 * to filter on; this matches their titles instead.
 *
 * This only decides the DEFAULT for an offer with no row in offer_display_settings. The admin
 * page shows every offer and its explicit setting always wins, so a wrong guess here is
 * visible and one click to correct.
 */
const INTERNAL_TITLE_PATTERNS = [
  /logo visibility/i,
  /spend stimulation/i,
  /visibility offer/i,
]

function normalise(o: RawOffer): PublicOffer | null {
  if (o.status !== 'ACTIVE') return null
  if (o.display_config?.is_hidden) return null

  const methods = new Set<string>()
  const issuers = new Set<string>()
  for (const rule of o.rules?.items ?? []) {
    const pi = rule.criteria?.includes?.paymentInstrument
    if (!pi) continue
    for (const m of pi.methods ?? []) methods.add(String(m))
    for (const i of pi.card?.issuers ?? []) issuers.add(ISSUER_NAMES[String(i)] ?? String(i))
  }

  const title = (o.display_name || o.name || '').trim()
  if (!title) return null

  return {
    id: o.id,
    title,
    methods: [...methods],
    issuers: [...issuers],
    endsAt: o.ends_at ? new Date(Number(o.ends_at) * 1000).toISOString() : null,
    terms: o.terms?.tnc?.trim() || null,
  }
}

export interface OfferSetting {
  offer_id: string
  is_visible: boolean
  title_override: string | null
  display_order: number
  updated_at: string
}

/** Every active offer on the account, merged with the admin's display settings. */
export async function getOffersWithSettings(): Promise<Array<PublicOffer & {
  isVisible: boolean
  titleOverride: string | null
  displayOrder: number
  looksInternal: boolean
}>> {
  const { queryMany } = await import('./db')
  const [offers, rows] = await Promise.all([
    getAccountOffers(),
    queryMany<OfferSetting>('SELECT offer_id, is_visible, title_override, display_order, updated_at FROM offer_display_settings')
      .catch(() => [] as OfferSetting[]),
  ])
  const byId = new Map(rows.map((r) => [r.offer_id, r]))

  return offers
    .map((o) => {
      const s = byId.get(o.id)
      const looksInternal = INTERNAL_TITLE_PATTERNS.some((re) => re.test(o.title))
      return {
        ...o,
        isVisible: s ? s.is_visible : !looksInternal,
        titleOverride: s?.title_override ?? null,
        displayOrder: s?.display_order ?? 0,
        looksInternal,
      }
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title))
}

/**
 * What the storefront shows: active offers the admin has not hidden, using any title override.
 * Returns [] on any failure — a storefront must not break because Razorpay is slow, and
 * showing nothing is correct when we cannot confirm an offer is real.
 */
export async function getPublicOffers(): Promise<PublicOffer[]> {
  const all = await getOffersWithSettings().catch(() => [])
  return all
    .filter((o) => o.isVisible)
    .map(({ id, title, titleOverride, methods, issuers, endsAt, terms }) => ({
      id, title: titleOverride || title, methods, issuers, endsAt, terms,
    }))
}

/** Raw active offers from Razorpay, before any admin curation. */
export async function getAccountOffers(): Promise<PublicOffer[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.offers

  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) return []

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
    const res = await fetch(OFFERS_URL, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return cache?.offers ?? []

    const body = await res.json() as { items?: RawOffer[] }
    const offers = (body.items ?? []).map(normalise).filter((o): o is PublicOffer => !!o)
    cache = { at: Date.now(), offers }
    return offers
  } catch {
    return cache?.offers ?? []
  }
}
