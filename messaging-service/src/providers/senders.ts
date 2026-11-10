import { db } from '../db.js'
import { decryptToken } from '../cipher.js'
import { PLATFORM_TENANT_ID } from '../templates-v2.js'

// A store's own sender (DLT header / WhatsApp number) and provider credentials from the control plane's
// tenant_messaging_senders (written by the flagship admin through lib/messaging/tenant-senders.ts). The
// Twilio / AWS providers take it as an override; without a row the platform env sends, exactly as before.

export type SenderChannel = 'sms' | 'whatsapp'
export type SenderProvider = 'twilio' | 'aws'

export interface SenderOverride {
  /** The number / DLT header to send from. */
  sender: string
  /** Decrypted credential blob (keys per provider, see docs/plans/UPI_AND_MESSAGING_ADDON.md §2.1). */
  config: Record<string, string>
}

export interface TenantSender extends SenderOverride {
  channel: SenderChannel
  provider: SenderProvider
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; sender: TenantSender | null }>()

export function invalidateTenantSenders(tenantId?: string) {
  if (!tenantId) return cache.clear()
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k)
}

export class SenderError extends Error {}

/** null for the platform tenant, when the tenant has no active row, or when the table is missing. Throws
 *  SenderError when a row exists but can't be decrypted — the send must fail rather than use the platform number. */
export async function tenantSender(tenantId: string, channel: SenderChannel): Promise<TenantSender | null> {
  if (!tenantId || tenantId === PLATFORM_TENANT_ID) return null
  const key = `${tenantId}:${channel}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.sender
  let row: { provider: string; sender: string; config_enc: string } | undefined
  try {
    row = (await db.query<NonNullable<typeof row>>(
      `SELECT provider, sender, config_enc FROM tenant_messaging_senders WHERE tenant_id=$1::uuid AND channel=$2 AND status='active'`,
      [tenantId, channel]
    )).rows[0]
  } catch {
    return null // table not there yet / control plane down: not cached, the next send retries
  }
  let sender: TenantSender | null = null
  if (row && (row.provider === 'twilio' || row.provider === 'aws')) {
    let config: Record<string, string>
    try {
      config = JSON.parse(decryptToken(row.config_enc))
    } catch (e: any) {
      throw new SenderError(`This store's ${channel} sender credentials cannot be read (${e?.message ?? e})`)
    }
    sender = { channel, provider: row.provider, sender: row.sender, config }
  }
  cache.set(key, { at: Date.now(), sender })
  return sender
}
