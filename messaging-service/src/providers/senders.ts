import { db } from '../db.js'
import { decryptToken } from '../cipher.js'

// A store's own sender (DLT header / WhatsApp number) and provider credentials from the control plane's
// tenant_messaging_senders (written by the flagship admin through lib/messaging/tenant-senders.ts), one row per
// (tenant, channel, audience). The Twilio / AWS providers take it as an override; a missing audience falls back to
// the customer row, and with no row at all the platform env sends, exactly as before.

export type SenderChannel = 'sms' | 'whatsapp'
export type SenderProvider = 'twilio' | 'aws'
export type SenderAudience = 'customer' | 'admin' | 'ecom'

export interface SenderOverride {
  /** The number / DLT header to send from. */
  sender: string
  /** Decrypted credential blob (keys per provider, see docs/plans/UPI_AND_MESSAGING_ADDON.md §2.1). */
  config: Record<string, string>
}

export interface TenantSender extends SenderOverride {
  /** Whose row it is: a workspace without a number of its own sends from the platform's ecom row. */
  tenantId: string
  channel: SenderChannel
  provider: SenderProvider
  audience: SenderAudience
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; sender: TenantSender | null }>()

export function invalidateTenantSenders(tenantId?: string) {
  if (!tenantId) return cache.clear()
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k)
}

export class SenderError extends Error {}

/** The audience's own row, else the customer row; null when neither exists or the table is missing. Throws
 *  SenderError when a row exists but can't be decrypted — the send must fail rather than use another number. */
export async function tenantSender(tenantId: string, channel: SenderChannel, audience: SenderAudience = 'customer'): Promise<TenantSender | null> {
  if (!tenantId) return null
  const key = `${tenantId}:${channel}:${audience}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.sender
  let row: { audience: string; provider: string; sender: string; config_enc: string } | undefined
  try {
    row = (await db.query<NonNullable<typeof row>>(
      `SELECT audience, provider, sender, config_enc FROM tenant_messaging_senders
        WHERE tenant_id=$1::uuid AND channel=$2 AND audience IN ($3,'customer') AND status='active'
        ORDER BY (audience=$3) DESC LIMIT 1`,
      [tenantId, channel, audience]
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
    const a = row.audience === 'admin' || row.audience === 'ecom' ? row.audience : 'customer'
    sender = { tenantId, channel, provider: row.provider, sender: row.sender, config, audience: a }
  }
  cache.set(key, { at: Date.now(), sender })
  return sender
}
