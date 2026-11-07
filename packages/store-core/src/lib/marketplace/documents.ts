import { query, queryOne } from '@/lib/shared/db'
import { getImportFile, putObjectBuffer } from '@/lib/shared/s3'
import type { DocumentKind, MarketplaceAdapter, MarketplaceDocument } from './adapter'
import { CHANNEL_LABEL, type MarketplaceChannel } from './types'

// Label, invoice and manifest PDFs for a marketplace order. The first download fetches the file
// from the marketplace and keeps a copy in the store's bucket under marketplace/{channel}/{ref}/
// (ref = the marketplace order id, or the manifest id); later downloads come from there.

export const DOCUMENT_KINDS: readonly DocumentKind[] = ['label', 'invoice', 'manifest']

const COLUMN: Record<DocumentKind, 'label_key' | 'invoice_key' | 'manifest_key'> = { label: 'label_key', invoice: 'invoice_key', manifest: 'manifest_key' }

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)

export const documentKey = (channel: MarketplaceChannel, ref: string, kind: DocumentKind) => `marketplace/${channel}/${safe(ref)}/${kind}.pdf`

export class DocumentUnavailableError extends Error {
  readonly status = 409
}

interface DocRow {
  external_order_id: string
  shipment_id: string | null
  packet_id: string | null
  manifest_id: string | null
  label_key: string | null
  invoice_key: string | null
  manifest_key: string | null
}

export async function marketplaceDocument(channel: MarketplaceChannel, marketplaceOrderId: string, kind: DocumentKind, adapter: MarketplaceAdapter): Promise<MarketplaceDocument | null> {
  const row = await queryOne<DocRow>(
    `SELECT mo.external_order_id, s.id AS shipment_id, s.packet_id, s.manifest_id, s.label_key, s.invoice_key, s.manifest_key
       FROM marketplace_orders mo
       LEFT JOIN LATERAL (SELECT * FROM marketplace_shipments ms WHERE ms.marketplace_order_id = mo.id ORDER BY ms.created_at DESC LIMIT 1) s ON true
      WHERE mo.channel = $1 AND mo.id = $2`,
    [channel, marketplaceOrderId]
  )
  if (!row) return null
  if (kind === 'manifest' && !row.manifest_id) throw new DocumentUnavailableError('No manifest has been created for this order yet.')
  const ref = kind === 'manifest' ? row.manifest_id! : row.external_order_id
  const filename = `${CHANNEL_LABEL[channel]}-${kind}-${safe(ref)}.pdf`
  const cache = adapter.mode !== 'mock'
  const key = row[COLUMN[kind]] ?? documentKey(channel, ref, kind)
  if (cache) {
    const body = await getImportFile(key).catch(() => null)
    if (body?.length) return { contentType: 'application/pdf', filename, body }
  }
  const doc = await adapter.document(kind, row.external_order_id, kind === 'manifest' ? row.manifest_id! : row.packet_id ?? undefined)
  if (cache) {
    try {
      await putObjectBuffer(key, doc.body, doc.contentType || 'application/pdf')
      if (kind === 'manifest') await query(`UPDATE marketplace_shipments SET manifest_key = $3, updated_at = now() WHERE channel = $1 AND manifest_id = $2`, [channel, row.manifest_id, key])
      else if (row.shipment_id) await query(`UPDATE marketplace_shipments SET ${COLUMN[kind]} = $2, updated_at = now() WHERE id = $1`, [row.shipment_id, key])
    } catch (e) {
      console.warn(`[${channel}] could not cache the ${kind} PDF`, e instanceof Error ? e.message : e)
    }
  }
  return { ...doc, filename }
}

/** Keeps a manifest PDF the marketplace returned when the manifest was created. */
export async function cacheManifest(channel: MarketplaceChannel, manifestId: string, doc: MarketplaceDocument): Promise<void> {
  const key = documentKey(channel, manifestId, 'manifest')
  try {
    await putObjectBuffer(key, doc.body, doc.contentType || 'application/pdf')
    await query(`UPDATE marketplace_shipments SET manifest_key = $3, updated_at = now() WHERE channel = $1 AND manifest_id = $2`, [channel, manifestId, key])
  } catch (e) {
    console.warn(`[${channel}] could not cache the manifest PDF`, e instanceof Error ? e.message : e)
  }
}
