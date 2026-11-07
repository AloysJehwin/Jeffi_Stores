import { query, queryMany } from '@/lib/shared/db'
import type { MarketplaceAdapter } from './adapter'
import { cacheManifest } from './documents'
import type { MarketplaceChannel } from './types'

// A manifest hands a batch of ready-to-dispatch packets to the marketplace's courier (AJIO: at most
// 250 per manifest). Each packet goes on one manifest.

export interface ManifestCandidate {
  id: string
  external_order_id: string
  status: string
  shipment_id: string | null
  packet_id: string | null
  manifest_id: string | null
}

export async function loadManifestCandidates(channel: MarketplaceChannel, ids: string[]): Promise<ManifestCandidate[]> {
  return queryMany<ManifestCandidate>(
    `SELECT mo.id, mo.external_order_id, mo.status, s.id AS shipment_id, s.packet_id, s.manifest_id
       FROM marketplace_orders mo
       LEFT JOIN LATERAL (SELECT * FROM marketplace_shipments ms WHERE ms.marketplace_order_id = mo.id AND ms.packet_id IS NOT NULL ORDER BY ms.created_at DESC LIMIT 1) s ON true
      WHERE mo.channel = $1 AND mo.id = ANY($2::uuid[])`,
    [channel, ids]
  )
}

/** Why these orders can't go on a new manifest (empty = they can). */
export function manifestProblems(ids: string[], rows: ManifestCandidate[], max: number): string[] {
  if (!ids.length) return ['Pick at least one packet.']
  if (ids.length > max) return [`A manifest takes at most ${max} packets; you picked ${ids.length}.`]
  const found = new Map(rows.map(r => [r.id, r]))
  const problems: string[] = []
  const missing = ids.filter(id => !found.has(id)).length
  if (missing) problems.push(`${missing} of the picked orders were not found.`)
  for (const r of rows) {
    if (r.status !== 'ready_to_dispatch') problems.push(`${r.external_order_id} is not ready to dispatch.`)
    else if (!r.packet_id) problems.push(`${r.external_order_id} has no packet yet.`)
    else if (r.manifest_id) problems.push(`${r.external_order_id} is already on manifest ${r.manifest_id}.`)
  }
  return problems.slice(0, 10)
}

export async function createMarketplaceManifest(channel: MarketplaceChannel, adapter: MarketplaceAdapter, rows: ManifestCandidate[]): Promise<{ manifestId: string; packets: number }> {
  if (!adapter.createManifest) throw new Error('This marketplace has no manifest API.')
  const packetIds = rows.map(r => r.packet_id!).filter(Boolean)
  const { manifestId, document } = await adapter.createManifest(packetIds)
  await query(`UPDATE marketplace_shipments SET manifest_id = $2, updated_at = now() WHERE id = ANY($1::uuid[])`, [rows.map(r => r.shipment_id), manifestId])
  if (document && adapter.mode !== 'mock') await cacheManifest(channel, manifestId, document)
  return { manifestId, packets: packetIds.length }
}
