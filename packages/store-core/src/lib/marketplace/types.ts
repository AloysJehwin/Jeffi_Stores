// Shared shapes for the Myntra and AJIO integrations. Adapters turn each marketplace's payloads into
// these; everything downstream (upsert, stock, pages) only sees the normalised form.

export type MarketplaceChannel = 'myntra' | 'ajio'
export type MarketplaceMode = 'live' | 'sandbox' | 'mock'

export const MARKETPLACE_CHANNELS: readonly MarketplaceChannel[] = ['myntra', 'ajio']

export const isMarketplaceChannel = (s: unknown): s is MarketplaceChannel => s === 'myntra' || s === 'ajio'

export const CHANNEL_LABEL: Record<MarketplaceChannel, string> = { myntra: 'Myntra', ajio: 'AJIO' }

/** Order number prefix on our orders (MYN-…, AJI-…). */
export const ORDER_PREFIX: Record<MarketplaceChannel, string> = { myntra: 'MYN', ajio: 'AJI' }

export const MARKET_STATUSES = [
  'created',
  'accepted',
  'packed',
  'ready_to_dispatch',
  'shipped',
  'delivered',
  'cancelled',
  'rejected',
  'returned',
] as const
export type MarketStatus = (typeof MARKET_STATUSES)[number]

/** Progress order; an event below the order's current rank is stale. Terminal states rank highest. */
export const STATUS_RANK: Record<MarketStatus, number> = {
  created: 10,
  accepted: 20,
  packed: 30,
  ready_to_dispatch: 40,
  shipped: 50,
  delivered: 60,
  cancelled: 90,
  rejected: 90,
  returned: 100,
}

export const isMarketStatus = (s: unknown): s is MarketStatus => typeof s === 'string' && (MARKET_STATUSES as readonly string[]).includes(s)

export type StockState = 'none' | 'deducted' | 'restored' | 'short' | 'unmatched'
export type StockAction = 'deduct' | 'restore' | 'none'

export interface ShipmentInfo {
  packetId?: string | null
  trackingNumber?: string | null
  courier?: string | null
  trackingUrl?: string | null
  manifestId?: string | null
  lineIds?: string[]
}

export interface NormalizedLine {
  /** The marketplace's line (or unit) id. */
  lineId: string
  sku: string
  styleId?: string | null
  title?: string | null
  size?: string | null
  colour?: string | null
  quantity: number
  /** Selling price per unit, tax included. */
  unitPrice: number
  /** Tax per unit, when the marketplace sends it. */
  unitTax?: number | null
  mrp?: number | null
  status?: MarketStatus | null
}

export interface NormalizedOrder {
  channel: MarketplaceChannel
  externalOrderId: string
  status: MarketStatus
  rawStatus?: string | null
  /** When the marketplace says this status happened; drives the stale-event guard. */
  eventAt?: string | null
  placedAt?: string | null
  acceptBy?: string | null
  dispatchBy?: string | null
  currency?: string | null
  total?: number | null
  shipping?: { city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null } | null
  /** The marketplace's own invoice number (Myntra). */
  invoiceRef?: string | null
  /** AJIO's B2B purchase order, raised when the order is packed. */
  po?: { number: string; date?: string | null; amount?: number | null; buyerGstin?: string | null; buyerName?: string | null } | null
  shipment?: ShipmentInfo | null
  /** A customer return or RTO this event reports. */
  returnInfo?: ReturnInfo | null
  lines: NormalizedLine[]
  raw?: unknown
}

export const RETURN_STATUSES = ['initiated', 'in_transit', 'received', 'qc_passed', 'qc_failed', 'closed', 'cancelled'] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

export interface ReturnInfo {
  externalReturnId: string
  type?: 'customer' | 'rto' | null
  status?: ReturnStatus | null
  reason?: string | null
  lineIds?: string[]
  refundAmount?: number | null
  trackingNumber?: string | null
}
