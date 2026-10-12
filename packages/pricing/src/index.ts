export type MessagingChannel = 'sms' | 'whatsapp' | 'email'
export type DocumentType = 'invoice' | 'quotation' | 'receipt' | 'packing_slip' | 'label' | 'purchase_order'

// Provider cost estimates (INR). SMS/WhatsApp are trued-up to the provider's exact price on the
// status callback; email has no callback so its estimate is the charge.
export const MESSAGING_COST_INR: Record<MessagingChannel, number> = { sms: 7, whatsapp: 1, email: 0.05 }
export const DOCUMENT_COST_INR: Record<DocumentType, number> = {
  invoice: 0.5, quotation: 0.5, receipt: 0.25, packing_slip: 0.25, label: 0.1, purchase_order: 0.5,
}
export const USD_INR_RATE = 88
export const PUBLIC_MARGIN = 0.4 // public API price = provider cost × (1 + margin)

export const round2 = (n: number) => Math.round(n * 100) / 100
export const toPaise = (inr: number) => Math.round(inr * 100)
export const usdToInr = (usd: number) => Math.round(Math.abs(usd) * USD_INR_RATE * 10000) / 10000

export function withMargin(costInr: number): number {
  return round2(costInr * (1 + PUBLIC_MARGIN))
}
export function messagePriceInr(channel: MessagingChannel, internal = false): number {
  return internal ? round2(MESSAGING_COST_INR[channel]) : withMargin(MESSAGING_COST_INR[channel])
}
export function documentPriceInr(type: DocumentType): number {
  return withMargin(DOCUMENT_COST_INR[type])
}
export function priceList() {
  return {
    margin: PUBLIC_MARGIN,
    currency: 'INR',
    messages: Object.fromEntries((Object.keys(MESSAGING_COST_INR) as MessagingChannel[]).map(c => [c, messagePriceInr(c)])),
    documents: Object.fromEntries((Object.keys(DOCUMENT_COST_INR) as DocumentType[]).map(d => [d, documentPriceInr(d)])),
  }
}
