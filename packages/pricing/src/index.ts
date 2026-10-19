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
export const USD_INR_RATE = 88
export const PUBLIC_MARGIN = 0.4 // public API price = provider cost × (1 + margin)

// Non-refundable processing fee (INR) kept on terminal failure under policy P2. Covers template
// render + provider roundtrip + webhook ingest even when the carrier rejects the message. The
// messaging-service refund paths read this to decide how much of the message:${id} / media:${id}
// debit to return. Internal / platform tier is 0 for every channel.
export const PROCESSING_FEE_INR: Record<MessagingChannel, number> = { whatsapp: 0.2, sms: 0.5, email: 0 }

export const round2 = (n: number) => Math.round(n * 100) / 100
export const toPaise = (inr: number) => Math.round(inr * 100)
export const usdToInr = (usd: number) => Math.round(Math.abs(usd) * USD_INR_RATE * 10000) / 10000

export function withMargin(costInr: number): number {
  return round2(costInr * (1 + PUBLIC_MARGIN))
}
export function messagePriceInr(channel: MessagingChannel, internal = false): number {
  return internal ? round2(MESSAGING_COST_INR[channel]) : withMargin(MESSAGING_COST_INR[channel])
}
export function mediaPriceInr(internal = false): number {
  return internal ? round2(MEDIA_COST_INR) : withMargin(MEDIA_COST_INR)
}
export function documentPriceInr(type: DocumentType): number {
  return withMargin(DOCUMENT_COST_INR[type])
}
export function processingFeeInr(channel: MessagingChannel, internal = false): number {
  if (internal) return 0
  const fee = PROCESSING_FEE_INR[channel]
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
    margin: PUBLIC_MARGIN,
    currency: 'INR',
    messages: Object.fromEntries((Object.keys(MESSAGING_COST_INR) as MessagingChannel[]).map(c => [c, messagePriceInr(c)])),
    documents: Object.fromEntries((Object.keys(DOCUMENT_COST_INR) as DocumentType[]).map(d => [d, documentPriceInr(d)])),
    media: mediaPriceInr(),
    processingFees: Object.fromEntries((Object.keys(PROCESSING_FEE_INR) as MessagingChannel[]).map(c => [c, processingFeeInr(c)])),
  }
}
