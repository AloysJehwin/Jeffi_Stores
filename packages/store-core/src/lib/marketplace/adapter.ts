import { createHash } from 'crypto'
import type { MarketplaceChannel, MarketplaceMode, MarketStatus, NormalizedOrder, ShipmentInfo } from './types'

// What every marketplace integration provides. Required methods cover orders and stock; listings,
// manifests, returns and settlements are optional because a marketplace may not offer the API.

/** One event out of a push body, before it is stored. `key` makes replays a no-op. */
export interface PushEvent {
  key: string
  type: string
  externalOrderId: string | null
  occurredAt: string | null
  payload: unknown
}

export interface InventoryUpdate {
  sku: string
  quantity: number
  warehouseId?: string | null
}

export interface InventoryResult {
  sku: string
  warehouseId?: string | null
  ok: boolean
  error?: string
}

export type OrderActionKind = 'accept' | 'reject' | 'pack' | 'ready_to_dispatch' | 'cancel'

export interface OrderActionInput {
  action: OrderActionKind
  externalOrderId: string
  /** Marketplace line ids; all lines when omitted. */
  lineIds?: string[]
  reason?: string
  /** Packed dimensions for RTD, when the marketplace asks for them. */
  packet?: { weightGrams?: number; lengthCm?: number; breadthCm?: number; heightCm?: number }
}

export interface OrderActionResult {
  ok: boolean
  status?: MarketStatus
  shipment?: ShipmentInfo | null
  message?: string
  raw?: unknown
}

export type DocumentKind = 'label' | 'invoice' | 'manifest'

export interface MarketplaceDocument {
  contentType: string
  filename: string
  body: Buffer
}

export interface ListingRow {
  sku: string
  styleId?: string | null
  attributes: Record<string, string | number | null>
}

export interface ListingTaskResult {
  taskId: string
  status: 'pending' | 'processing' | 'done' | 'partial' | 'failed'
  rows: { sku: string; ok: boolean; listingRef?: string | null; issues?: string[] }[]
  raw?: unknown
}

export interface ReturnActionInput {
  externalReturnId: string
  action: 'receive' | 'qc_pass' | 'qc_fail'
  note?: string
}

export interface SettlementRow {
  settlementRef: string
  externalOrderId?: string | null
  externalLineId?: string | null
  lineType: 'sale' | 'refund' | 'fee' | 'commission' | 'tax' | 'adjustment' | 'other'
  gross: number
  commission: number
  fees: number
  taxWithheld: number
  net: number
  postedOn?: string | null
  raw?: unknown
}

export interface MarketplaceAdapter {
  readonly channel: MarketplaceChannel
  readonly mode: MarketplaceMode
  /** Checks the credentials with a cheap authenticated call. */
  test(): Promise<{ ok: boolean; message: string }>
  /** Splits a push body into events. Throws on a body the marketplace would never send. */
  parsePush(body: unknown, headers: Headers): PushEvent[]
  /** The order an event describes, or null for events that are not about an order. */
  normalize(event: PushEvent): NormalizedOrder | null
  /** Tells the marketplace the orders were received, where it expects that. */
  ack(externalOrderIds: string[]): Promise<void>
  /** Absolute quantities. */
  pushInventory(updates: InventoryUpdate[]): Promise<InventoryResult[]>
  orderAction(input: OrderActionInput): Promise<OrderActionResult>
  document(kind: DocumentKind, externalOrderId: string, ref?: string): Promise<MarketplaceDocument>
  createManifest?(packetIds: string[]): Promise<{ manifestId: string; document?: MarketplaceDocument }>
  submitListings?(rows: ListingRow[]): Promise<{ taskId: string }>
  listingTask?(taskId: string): Promise<ListingTaskResult>
  returnAction?(input: ReturnActionInput): Promise<{ ok: boolean; message?: string; raw?: unknown }>
  settlements?(range: { from: string; to: string }): Promise<SettlementRow[]>
  /** Sends our B2B invoice for a purchase order (AJIO), where the marketplace wants it uploaded. */
  uploadInvoice?(input: InvoiceUpload): Promise<{ ok: boolean; message?: string }>
}

export interface InvoiceUpload {
  externalOrderId: string
  poNumber: string
  invoiceNumber: string
  invoiceDate: string
  amount: number
  pdf?: Buffer
}

/** The adapter can't handle this yet (a push its field mapping doesn't recognise, or an API it lacks).
 * Pushed events that hit this are kept and parked, not failed, until the mapping is corrected. */
export class AdapterUnavailableError extends Error {
  constructor(
    readonly channel: MarketplaceChannel,
    message = `The ${channel === 'myntra' ? 'Myntra' : 'AJIO'} API is not available until the partner API docs arrive. Use mock mode until then.`
  ) {
    super(message)
    this.name = 'AdapterUnavailableError'
  }
}

/** A stable event key from its identifying parts (used when the marketplace sends no event id). */
export function eventKey(...parts: (string | number | null | undefined)[]): string {
  return createHash('sha256').update(parts.map(p => String(p ?? '')).join('\u001f')).digest('hex').slice(0, 40)
}
