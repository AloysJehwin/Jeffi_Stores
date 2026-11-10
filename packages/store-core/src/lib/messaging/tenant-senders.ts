import { randomUUID } from 'crypto'
import { controlPlanePool } from '@/lib/tenant-registry'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'

// A store's own SMS / WhatsApp sender (DLT header or WhatsApp number) with the provider credentials
// to send through it: control-plane `tenant_messaging_senders`, one row per (tenant, channel). The
// credential blob is AES-GCM encrypted (token-cipher, SOCIAL_TOKEN_ENC_KEY); `meta` keeps masked hints
// for the UI. messaging-service reads the same rows (src/providers/senders.ts). The platform tenant
// never has a row: it sends from the platform env.

export type MessagingChannel = 'sms' | 'whatsapp'
export type SenderProvider = 'twilio' | 'aws'

export interface TenantSender {
  channel: MessagingChannel
  provider: SenderProvider
  /** DLT header / Twilio number for SMS, the WhatsApp number for WhatsApp. */
  sender: string
  /** Decrypted credentials — twilio: account_sid, auth_token | api_key_sid + api_key_secret, messaging_service_sid?;
   *  aws: region, access_key_id, secret_access_key, whatsapp_phone_number_id?, waba_id?, sms_origination?, dlt_entity_id?, configuration_set?. */
  config: Record<string, string>
  meta: Record<string, unknown>
}

/** A sender as the admin UI sees it: masked hints only, never the credentials. */
export interface TenantSenderMeta {
  channel: MessagingChannel
  provider: SenderProvider
  sender: string
  meta: Record<string, unknown>
  status: 'active' | 'disabled'
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const TTL_MS = 30_000
const cache = new Map<string, { at: number; sender: TenantSender | null }>()

const SECRET_KEYS = new Set(['auth_token', 'api_key_secret', 'secret_access_key'])
const LAST4_KEYS = new Set(['account_sid', 'api_key_sid', 'messaging_service_sid', 'access_key_id', 'waba_id', 'whatsapp_phone_number_id'])

const isChannel = (v: unknown): v is MessagingChannel => v === 'sms' || v === 'whatsapp'
const isProvider = (v: unknown): v is SenderProvider => v === 'twilio' || v === 'aws'
const last4 = (v: string) => (v.length > 4 ? `…${v.slice(-4)}` : '…')

/** Non-secret hints for the UI: secrets become `has_<key>`, ids keep their last 4, the rest passes through. */
export function maskSenderConfig(config: Record<string, string>): Record<string, unknown> {
  const meta: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (!v) continue
    if (SECRET_KEYS.has(k)) meta[`has_${k}`] = true
    else if (LAST4_KEYS.has(k)) meta[`${k}_last4`] = last4(v)
    else meta[k] = v
  }
  return meta
}

function cleanConfig(config: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(config)) {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s) out[k] = s
  }
  return out
}

function validate(channel: MessagingChannel, provider: SenderProvider, sender: string, c: Record<string, string>) {
  if (!sender) throw new Error('sender is required')
  if (provider === 'twilio') {
    if (!c.account_sid) throw new Error('Twilio account SID is required')
    if (!c.auth_token && !(c.api_key_sid && c.api_key_secret)) throw new Error('Twilio needs an auth token or an API key SID + secret')
  } else {
    if (!c.region || !c.access_key_id || !c.secret_access_key) throw new Error('AWS needs region, access key id and secret access key')
    if (channel === 'whatsapp' && !c.whatsapp_phone_number_id) throw new Error('AWS WhatsApp needs the phone number id')
  }
}

export function invalidateTenantSenders(tenantId?: string) {
  if (!tenantId) return cache.clear()
  for (const k of cache.keys()) if (k.startsWith(`${tenantId}:`)) cache.delete(k)
}

/** The tenant's active sender for a channel, decrypted; null for the platform tenant, when absent, or when the
 *  table is missing. Throws when a row exists but can't be decrypted (SOCIAL_TOKEN_ENC_KEY): never silently
 *  send a store's messages from the platform number. */
export async function getTenantSender(tenantId: string, channel: MessagingChannel): Promise<TenantSender | null> {
  if (!tenantId || tenantId === PLATFORM_TENANT_ID) return null
  const key = `${tenantId}:${channel}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.sender
  let row: { provider: string; sender: string; config_enc: string; meta: Record<string, unknown> | null } | undefined
  try {
    row = (await controlPlanePool().query<NonNullable<typeof row>>(
      `SELECT provider, sender, config_enc, meta FROM tenant_messaging_senders WHERE tenant_id=$1::uuid AND channel=$2 AND status='active'`,
      [tenantId, channel]
    )).rows[0]
  } catch {
    return null // missing table / control plane down: platform env, not cached so the next call retries
  }
  let sender: TenantSender | null = null
  if (row && isProvider(row.provider)) {
    let config: Record<string, string>
    try {
      config = JSON.parse(decryptToken(row.config_enc))
    } catch (e: any) {
      throw new Error(`tenant sender for ${channel} cannot be decrypted: ${e?.message ?? e}`)
    }
    sender = { channel, provider: row.provider, sender: row.sender, config, meta: row.meta ?? {} }
  }
  cache.set(key, { at: Date.now(), sender })
  return sender
}

/** Every sender row of a tenant, masked (no credentials). */
export async function listTenantSenders(tenantId: string): Promise<TenantSenderMeta[]> {
  if (!tenantId || tenantId === PLATFORM_TENANT_ID) return []
  try {
    const r = await controlPlanePool().query<{
      channel: string; provider: string; sender: string; meta: Record<string, unknown> | null; status: string
      created_by: string | null; created_at: string; updated_at: string
    }>(
      `SELECT channel, provider, sender, meta, status, created_by, created_at, updated_at
         FROM tenant_messaging_senders WHERE tenant_id=$1::uuid ORDER BY channel`,
      [tenantId]
    )
    return r.rows
      .filter(x => isChannel(x.channel) && isProvider(x.provider))
      .map(x => ({
        channel: x.channel as MessagingChannel,
        provider: x.provider as SenderProvider,
        sender: x.sender,
        meta: x.meta ?? {},
        status: x.status === 'disabled' ? 'disabled' : 'active',
        createdBy: x.created_by,
        createdAt: new Date(x.created_at).toISOString(),
        updatedAt: new Date(x.updated_at).toISOString(),
      }))
  } catch {
    return []
  }
}

/** Create or replace the tenant's sender for a channel. Throws on invalid input or a missing cipher key. */
export async function saveTenantSender(i: {
  tenantId: string
  channel: MessagingChannel
  provider: SenderProvider
  sender: string
  config: Record<string, string | null | undefined>
  createdBy?: string | null
}): Promise<TenantSenderMeta> {
  if (!i.tenantId || i.tenantId === PLATFORM_TENANT_ID) throw new Error('the platform tenant sends from its own env')
  if (!isChannel(i.channel)) throw new Error('channel must be sms or whatsapp')
  if (!isProvider(i.provider)) throw new Error('provider must be twilio or aws')
  const sender = (i.sender ?? '').trim()
  const config = cleanConfig(i.config ?? {})
  validate(i.channel, i.provider, sender, config)
  const meta = maskSenderConfig(config)
  const r = await controlPlanePool().query<{ created_by: string | null; created_at: string; updated_at: string }>(
    `INSERT INTO tenant_messaging_senders (id, tenant_id, channel, provider, sender, config_enc, meta, status, created_by)
     VALUES ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,'active',$8)
     ON CONFLICT (tenant_id, channel) DO UPDATE SET
       provider=EXCLUDED.provider, sender=EXCLUDED.sender, config_enc=EXCLUDED.config_enc, meta=EXCLUDED.meta,
       status='active', created_by=EXCLUDED.created_by, updated_at=now()
     RETURNING created_by, created_at, updated_at`,
    [randomUUID(), i.tenantId, i.channel, i.provider, sender, encryptToken(JSON.stringify(config)), JSON.stringify(meta), i.createdBy ?? null]
  )
  invalidateTenantSenders(i.tenantId)
  const row = r.rows[0]
  return {
    channel: i.channel, provider: i.provider, sender, meta, status: 'active',
    createdBy: row?.created_by ?? i.createdBy ?? null,
    createdAt: new Date(row?.created_at ?? Date.now()).toISOString(),
    updatedAt: new Date(row?.updated_at ?? Date.now()).toISOString(),
  }
}

export async function deleteTenantSender(tenantId: string, channel: MessagingChannel): Promise<boolean> {
  if (!tenantId || tenantId === PLATFORM_TENANT_ID) return false
  const r = await controlPlanePool().query(`DELETE FROM tenant_messaging_senders WHERE tenant_id=$1::uuid AND channel=$2`, [tenantId, channel])
  invalidateTenantSenders(tenantId)
  return (r.rowCount ?? 0) > 0
}
