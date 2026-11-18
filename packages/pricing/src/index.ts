export type MessagingChannel = 'sms' | 'whatsapp' | 'email'
export type DocumentType = 'invoice' | 'quotation' | 'receipt' | 'packing_slip' | 'label' | 'purchase_order'

// Provider cost estimates (INR). SMS/WhatsApp are trued-up to the provider's exact price on the
// status callback; email has no callback so its estimate is the charge.
export const MESSAGING_COST_INR: Record<MessagingChannel, number> = { sms: 7, whatsapp: 1, email: 0.05 }
export const DOCUMENT_COST_INR: Record<DocumentType, number> = {
  invoice: 0.5, quotation: 0.5, receipt: 0.25, packing_slip: 0.25, label: 0.1, purchase_order: 0.5,
}
// Re-hosting a WhatsApp header (fetch or upload, convert to a WhatsApp-safe image, put on the CDN).
export const MEDIA_COST_INR = 0.5
export const USD_INR_RATE = 88 // last-resort fallback only; the live rate is below
export const PUBLIC_MARGIN = 0.4 // public API price = provider cost × (1 + margin)

// ── USD → INR ───────────────────────────────────────────────────────────────────────────────────
// The live rate (ECB reference via Frankfurter, else open.er-api.com). Every service shares it through control-plane
// platform_infra 'fx_usd_inr' (refreshUsdInr with that row as the store) and fetches again once it is older than
// FX_TTL_MS. If no source answers, the last stored rate stands, then USD_INR_RATE.

export interface FxRate {
  rate: number
  source: string
  fetchedAt: string
}
export const FX_TTL_MS = 6 * 60 * 60 * 1000
const FX_SOURCES = [
  { source: 'ECB via frankfurter.dev', url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR' },
  { source: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD' },
]
const saneRate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 40 && n < 250

/** The current USD→INR rate from the first source that answers, or null. */
export async function fetchUsdInr(timeoutMs = 4000): Promise<FxRate | null> {
  for (const s of FX_SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(timeoutMs) })
      const rate = res.ok ? ((await res.json()) as { rates?: { INR?: unknown } })?.rates?.INR : null
      if (saneRate(rate)) return { rate: Math.round(rate * 10000) / 10000, source: s.source, fetchedAt: new Date().toISOString() }
    } catch {
      // try the next source
    }
  }
  return null
}

let fx: FxRate = { rate: USD_INR_RATE, source: 'default', fetchedAt: new Date(0).toISOString() }
export const usdInrRate = (): FxRate => fx
export const usdInr = (): number => fx.rate
export function setUsdInr(r: FxRate | null | undefined) {
  if (r && saneRate(r.rate)) fx = r
}
const fresh = (r: FxRate | null): r is FxRate => !!r && saneRate(r.rate) && Date.now() - Date.parse(r.fetchedAt) < FX_TTL_MS

let fetching: Promise<void> | null = null
/** Bring the rate up to date from the shared store: a stored rate younger than FX_TTL_MS is used as is; an older one
 * is used while a fresh fetch runs (awaited with wait, or when nothing is stored) and is stored for the other
 * services. Never throws. */
export async function refreshUsdInr(store: { read(): Promise<FxRate | null>; write(r: FxRate): Promise<void> }, opts: { wait?: boolean } = {}): Promise<FxRate> {
  const stored = await store.read().catch(() => null)
  setUsdInr(stored)
  if (fresh(stored)) return fx
  fetching ??= fetchUsdInr()
    .then(async live => {
      if (!live) return
      setUsdInr(live)
      await store.write(live).catch(() => {})
    })
    .finally(() => {
      fetching = null
    })
  if (opts.wait || !stored) await fetching
  return fx
}

// Non-refundable processing fee (INR) kept on terminal failure under policy P2. Covers template
// render + provider roundtrip + webhook ingest even when the carrier rejects the message. The
// messaging-service refund paths read this to decide how much of the message:${id} / media:${id}
// debit to return. Internal / platform tier is 0 for every channel.
export const PROCESSING_FEE_INR: Record<MessagingChannel, number> = { whatsapp: 0.2, sms: 0.5, email: 0 }

// ── Message pricing sheet ───────────────────────────────────────────────────────────────────────
// Per provider and channel: the cost per message, the non-refundable processing fee, and whether the charge follows
// the provider's reported price on delivery (Twilio sends it; a fixed price otherwise). Plus the margin and the media
// fee (USD prices convert at the live rate above). The platform administrator edits it (Ecom → Configuration → Message pricing, control-plane
// platform_infra 'message_pricing'); each service loads it and calls setMessagePricing. Until then the defaults
// below (the old fixed values) apply, so nothing changes until someone edits the sheet.

export type PricedProvider = 'twilio' | 'aws' | 'msg91' | 'ses'
export interface MessageRate {
  costInr: number
  feeInr: number
  /** Charge the provider's reported price (× margin) once delivered, instead of the fixed cost. */
  exact: boolean
}
export interface MessagePricing {
  marginPct: number
  mediaInr: number
  rates: Record<string, MessageRate>
}
export const RATE_ROWS: { key: string; provider: PricedProvider; channel: MessagingChannel; label: string }[] = [
  { key: 'twilio:whatsapp', provider: 'twilio', channel: 'whatsapp', label: 'Twilio · WhatsApp' },
  { key: 'twilio:sms', provider: 'twilio', channel: 'sms', label: 'Twilio · SMS' },
  { key: 'aws:whatsapp', provider: 'aws', channel: 'whatsapp', label: 'AWS · WhatsApp' },
  { key: 'aws:sms', provider: 'aws', channel: 'sms', label: 'AWS · SMS' },
  { key: 'msg91:sms', provider: 'msg91', channel: 'sms', label: 'MSG91 · SMS (DLT)' },
  { key: 'ses:email', provider: 'ses', channel: 'email', label: 'Amazon SES · Email' },
]
export const DEFAULT_MESSAGE_PRICING: MessagePricing = {
  marginPct: Math.round(PUBLIC_MARGIN * 100),
  mediaInr: MEDIA_COST_INR,
  rates: {
    'twilio:whatsapp': { costInr: MESSAGING_COST_INR.whatsapp, feeInr: PROCESSING_FEE_INR.whatsapp, exact: true },
    'twilio:sms': { costInr: MESSAGING_COST_INR.sms, feeInr: PROCESSING_FEE_INR.sms, exact: true },
    'aws:whatsapp': { costInr: MESSAGING_COST_INR.whatsapp, feeInr: PROCESSING_FEE_INR.whatsapp, exact: false },
    'aws:sms': { costInr: MESSAGING_COST_INR.sms, feeInr: PROCESSING_FEE_INR.sms, exact: false },
    'msg91:sms': { costInr: 0.3, feeInr: 0.1, exact: false },
    'ses:email': { costInr: MESSAGING_COST_INR.email, feeInr: PROCESSING_FEE_INR.email, exact: false },
  },
}

let sheet: MessagePricing = DEFAULT_MESSAGE_PRICING
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)

/** A stored sheet merged over the defaults (missing or invalid values keep the default). */
export function normalizeMessagePricing(p?: Partial<MessagePricing> | null): MessagePricing {
  const d = DEFAULT_MESSAGE_PRICING
  const rates: Record<string, MessageRate> = {}
  for (const r of RATE_ROWS) {
    const v = (p?.rates ?? {})[r.key] ?? {}
    const def = d.rates[r.key]
    rates[r.key] = { costInr: num((v as any).costInr, def.costInr), feeInr: num((v as any).feeInr, def.feeInr), exact: typeof (v as any).exact === 'boolean' ? (v as any).exact : def.exact }
  }
  return { marginPct: num(p?.marginPct, d.marginPct), mediaInr: num(p?.mediaInr, d.mediaInr), rates }
}
export function setMessagePricing(p?: Partial<MessagePricing> | null) {
  sheet = normalizeMessagePricing(p)
}
export const messagePricing = (): MessagePricing => sheet

function rateFor(channel: MessagingChannel, provider?: string | null): MessageRate {
  if (channel === 'email') return sheet.rates['ses:email']
  return sheet.rates[`${provider || 'twilio'}:${channel}`] ?? sheet.rates[`twilio:${channel}`]
}

export const round2 = (n: number) => Math.round(n * 100) / 100
export const toPaise = (inr: number) => Math.round(inr * 100)
export const usdToInr = (usd: number) => Math.round(Math.abs(usd) * fx.rate * 10000) / 10000

export function withMargin(costInr: number): number {
  return round2(costInr * (1 + sheet.marginPct / 100))
}
/** What a store pays per message on this provider: its cost, plus the margin unless internal (the platform's own sends). */
export function messagePriceInr(channel: MessagingChannel, internal = false, provider?: string | null): number {
  const cost = rateFor(channel, provider).costInr
  return internal ? round2(cost) : withMargin(cost)
}
/** Whether the charge follows the provider's reported price once delivered (else the fixed price stands). */
export function followsProviderPrice(channel: MessagingChannel, provider?: string | null): boolean {
  return rateFor(channel, provider).exact
}
export function mediaPriceInr(internal = false): number {
  return internal ? round2(sheet.mediaInr) : withMargin(sheet.mediaInr)
}
export function documentPriceInr(type: DocumentType): number {
  return withMargin(DOCUMENT_COST_INR[type])
}
export function processingFeeInr(channel: MessagingChannel, internal = false, provider?: string | null): number {
  if (internal) return 0
  const fee = rateFor(channel, provider)?.feeInr
  return typeof fee === 'number' ? round2(fee) : 0
}

export type PriceList = {
  margin: number
  currency: 'INR'
  messages: Record<string, number>
  documents: Record<string, number>
  media: number
  // Optional sibling that mirrors `messages` keys and gives the non-refundable processing fee kept
  // on terminal failure. Optional for backwards-compat: older callers that only read priceInr are
  // unaffected.
  processingFees?: Record<string, number>
}
export function priceList(): PriceList {
  return {
    margin: sheet.marginPct / 100,
    currency: 'INR',
    messages: Object.fromEntries((['sms', 'whatsapp', 'email'] as MessagingChannel[]).map(c => [c, messagePriceInr(c)])),
    documents: Object.fromEntries((Object.keys(DOCUMENT_COST_INR) as DocumentType[]).map(d => [d, documentPriceInr(d)])),
    media: mediaPriceInr(),
    processingFees: Object.fromEntries((['sms', 'whatsapp', 'email'] as MessagingChannel[]).map(c => [c, processingFeeInr(c)])),
  }
}
