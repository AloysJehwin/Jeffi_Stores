import { randomUUID } from 'crypto'
import { controlPlanePool } from '@/lib/tenant-registry'
import { decryptToken, encryptToken } from '@/lib/crypto/token-cipher'
import { IN_DLT_REGION, indiaDltError, isIndiaDltConfig } from '@/lib/messaging/dlt-sender'
import { getSmsDltConfig } from '@/lib/providers/sms-dlt'
import { AUDIENCE_CHANNELS, PLATFORM_TENANT_ID, audiencesFor, isSenderAudience, type MessagingChannel, type SenderAudience } from '@/lib/messaging/audiences'

export { AUDIENCE_CHANNELS, PLATFORM_TENANT_ID, audiencesFor, isSenderAudience, type MessagingChannel, type SenderAudience }

// A store's own SMS / WhatsApp senders (DLT header or WhatsApp number) with the provider credentials to send
// through them: control-plane `tenant_messaging_senders`, one row per (tenant, channel, audience). Audiences:
// customer (shoppers), admin (store staff: the admin agent, staff OTP), ecom (flagship only: store owners on the
// ecom portal). A missing audience falls back to the customer row; the platform tenant with no row sends from
// the platform env. The credential blob is AES-GCM encrypted (token-cipher, SOCIAL_TOKEN_ENC_KEY); `meta` keeps
// masked hints for the UI. messaging-service reads the same rows (src/providers/senders.ts).

export type SenderProvider = 'twilio' | 'aws'

export interface TenantSender {
  channel: MessagingChannel
  audience: SenderAudience
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
  audience: SenderAudience
  provider: SenderProvider
  sender: string
  meta: Record<string, unknown>
  /** pending: not used for sending yet (a bought WhatsApp number waiting to go Online); the audience falls back. */
  status: 'active' | 'pending' | 'disabled'
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; sender: TenantSender | null }>()

const SECRET_KEYS = new Set(['auth_token', 'api_key_secret', 'secret_access_key'])
const LAST4_KEYS = new Set(['account_sid', 'api_key_sid', 'messaging_service_sid', 'access_key_id', 'waba_id', 'whatsapp_phone_number_id'])

const isChannel = (v: unknown): v is MessagingChannel => v === 'sms' || v === 'whatsapp'
const isProvider = (v: unknown): v is SenderProvider => v === 'twilio' || v === 'aws'
const last4 = (v: string) => (v.length > 4 ? `…${v.slice(-4)}` : '…')
const digits = (v: string) => v.replace(/\D/g, '')



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

/** The flagship may leave Twilio credentials out: its numbers are bought in the platform's own Twilio account, which
 *  the platform env already holds — no second copy of that auth token in the database. */
export const usesPlatformAccount = (tenantId: string, provider: SenderProvider, c: Record<string, string>) =>
  tenantId === PLATFORM_TENANT_ID && provider === 'twilio' && !c.account_sid && !c.auth_token && !c.api_key_sid && !c.api_key_secret

function validate(channel: MessagingChannel, provider: SenderProvider, sender: string, c: Record<string, string>, tenantId: string) {
  if (!sender) throw new Error('sender is required')
  if (usesPlatformAccount(tenantId, provider, c)) return
  if (provider === 'aws' && isIndiaDltConfig(c)) {
    if (channel !== 'sms') throw new Error('The platform AWS account is only for India SMS (DLT)')
    if (c.access_key_id || c.secret_access_key) throw new Error("Do not enter AWS keys with the platform's AWS account")
    return
  }
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

type Row = { audience: string; provider: string; sender: string; config_enc: string; meta: Record<string, unknown> | null }

function decrypt(channel: MessagingChannel, row: Row): TenantSender | null {
  if (!isProvider(row.provider)) return null
  let config: Record<string, string>
  try {
    config = JSON.parse(decryptToken(row.config_enc))
  } catch (e: any) {
    throw new Error(`tenant sender for ${channel} cannot be decrypted: ${e?.message ?? e}`)
  }
  return {
    channel,
    audience: isSenderAudience(row.audience) ? row.audience : 'customer',
    provider: row.provider,
    sender: row.sender,
    config,
    meta: row.meta ?? {},
  }
}

/** The tenant's active sender for a channel and audience, decrypted: the audience's own row, else the customer row.
 *  null when neither exists (the platform then sends from its env) or the table is missing. Throws when a row
 *  exists but can't be decrypted (SOCIAL_TOKEN_ENC_KEY): never silently send a store's messages from another number. */
export async function getTenantSender(
  tenantId: string,
  channel: MessagingChannel,
  audience: SenderAudience = 'customer'
): Promise<TenantSender | null> {
  if (!tenantId) return null
  const key = `${tenantId}:${channel}:${audience}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.sender
  let row: Row | undefined
  try {
    row = (await controlPlanePool().query<Row>(
      `SELECT audience, provider, sender, config_enc, meta FROM tenant_messaging_senders
        WHERE tenant_id=$1::uuid AND channel=$2 AND audience IN ($3,'customer') AND status='active'
        ORDER BY (audience=$3) DESC LIMIT 1`,
      [tenantId, channel, audience]
    )).rows[0]
  } catch {
    return null // missing table / control plane down: platform env, not cached so the next call retries
  }
  const sender = row ? decrypt(channel, row) : null
  cache.set(key, { at: Date.now(), sender })
  return sender
}

/** Whether the tenant has a number of its own for this audience (no fallback to the customer row). */
export async function hasOwnAudienceSender(tenantId: string, channel: MessagingChannel, audience: SenderAudience): Promise<boolean> {
  try {
    const r = await controlPlanePool().query(
      `SELECT 1 FROM tenant_messaging_senders WHERE tenant_id=$1::uuid AND channel=$2 AND audience=$3 AND status='active' LIMIT 1`,
      [tenantId, channel, audience]
    )
    return (r.rowCount ?? 0) > 0
  } catch {
    return false
  }
}

/** Inbound routing: which tenant and audience own the number a message was sent to. Matches on digits, so
 *  `whatsapp:+91 98…` and `+9198…` are the same number. null when no row has it (the caller falls back to the
 *  platform env number / the `?t=` hint). */
export async function findSenderByNumber(number: string, channel: MessagingChannel): Promise<(TenantSender & { tenantId: string }) | null> {
  const d = digits(number || '')
  if (d.length < 6) return null
  try {
    const row = (await controlPlanePool().query<Row & { tenant_id: string }>(
      `SELECT tenant_id::text, audience, provider, sender, config_enc, meta FROM tenant_messaging_senders
        WHERE regexp_replace(sender, '\\D', '', 'g') = $1 AND channel=$2 AND status='active'
        ORDER BY (tenant_id <> $3::uuid) DESC LIMIT 1`,
      [d, channel, PLATFORM_TENANT_ID]
    )).rows[0]
    if (!row) return null
    const s = decrypt(channel, row)
    return s ? { ...s, tenantId: row.tenant_id } : null
  } catch {
    return null
  }
}

/** Every sender row of a tenant, masked (no credentials). */
export async function listTenantSenders(tenantId: string): Promise<TenantSenderMeta[]> {
  if (!tenantId) return []
  try {
    const r = await controlPlanePool().query<{
      channel: string; audience: string; provider: string; sender: string; meta: Record<string, unknown> | null; status: string
      created_by: string | null; created_at: string; updated_at: string
    }>(
      `SELECT channel, audience, provider, sender, meta, status, created_by, created_at, updated_at
         FROM tenant_messaging_senders WHERE tenant_id=$1::uuid ORDER BY audience, channel`,
      [tenantId]
    )
    return r.rows
      .filter(x => isChannel(x.channel) && isProvider(x.provider))
      .map(x => ({
        channel: x.channel as MessagingChannel,
        audience: isSenderAudience(x.audience) ? x.audience : 'customer',
        provider: x.provider as SenderProvider,
        sender: x.sender,
        meta: x.meta ?? {},
        status: x.status === 'disabled' ? 'disabled' : x.status === 'pending' ? 'pending' : 'active',
        createdBy: x.created_by,
        createdAt: new Date(x.created_at).toISOString(),
        updatedAt: new Date(x.updated_at).toISOString(),
      }))
  } catch {
    return []
  }
}

/** Create or replace the tenant's sender for a channel and audience. Throws on invalid input or a missing cipher key. */
export async function saveTenantSender(i: {
  tenantId: string
  channel: MessagingChannel
  audience?: SenderAudience
  provider: SenderProvider
  sender: string
  config: Record<string, string | null | undefined>
  createdBy?: string | null
  /** A number the platform bought in its own Twilio account (lib/messaging/tenant-numbers): sends with the platform
   *  env's credentials, so none are stored. Server code only, after checking the number is in that account. */
  platformAccount?: boolean
  /** Merged into `meta` (e.g. the Twilio number SID and WhatsApp sender SID). */
  extraMeta?: Record<string, unknown>
  /** pending: saved but not sent from until setTenantSenderStatus(…, 'active'). Default active. */
  status?: 'active' | 'pending'
}): Promise<TenantSenderMeta> {
  const status = i.status ?? 'active'
  const audience = i.audience ?? 'customer'
  if (!i.tenantId) throw new Error('tenant is required')
  if (!isChannel(i.channel)) throw new Error('channel must be sms or whatsapp')
  if (!isSenderAudience(audience) || !audiencesFor(i.tenantId).includes(audience)) throw new Error(`audience ${audience} is not available for this store`)
  if (!AUDIENCE_CHANNELS[audience].includes(i.channel)) throw new Error(`the ${audience} audience has no ${i.channel === 'sms' ? 'SMS' : 'WhatsApp'} number`)
  if (!isProvider(i.provider)) throw new Error('provider must be twilio or aws')
  const sender = (i.sender ?? '').trim()
  const config = cleanConfig(i.config ?? {})
  if (i.provider === 'aws' && isIndiaDltConfig(config)) {
    config.region = IN_DLT_REGION
    if (i.channel === 'sms') {
      const platform = (await getSmsDltConfig(null, { fresh: true }).catch(() => null))?.senderIds ?? []
      const bad = indiaDltError(sender, config, platform)
      if (bad) throw new Error(bad)
    }
  }
  if (!(i.platformAccount && i.provider === 'twilio' && !Object.keys(config).length)) validate(i.channel, i.provider, sender, config, i.tenantId)
  else if (!sender) throw new Error('sender is required')
  const dltHeader = i.provider === 'aws' && isIndiaDltConfig(config) // a header is shared across stores, not a number
  const taken = dltHeader ? { rows: [] as { tenant_id: string; audience: string }[] } : await controlPlanePool().query<{ tenant_id: string; audience: string }>(
    `SELECT tenant_id::text, audience FROM tenant_messaging_senders
      WHERE regexp_replace(sender, '\\D', '', 'g') = $1 AND channel=$2 AND NOT (tenant_id=$3::uuid AND audience=$4) LIMIT 1`,
    [digits(sender), i.channel, i.tenantId, audience]
  ).catch(() => ({ rows: [] as { tenant_id: string; audience: string }[] }))
  if (taken.rows[0]) throw new Error('this number is already assigned to another store or audience: one number serves one audience')
  const meta = { ...maskSenderConfig(config), ...(i.platformAccount ? { platform_account: true } : {}), ...(i.extraMeta ?? {}) }
  const r = await controlPlanePool().query<{ created_by: string | null; created_at: string; updated_at: string }>(
    `INSERT INTO tenant_messaging_senders (id, tenant_id, channel, audience, provider, sender, config_enc, meta, status, created_by)
     VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$10,$9)
     ON CONFLICT (tenant_id, channel, audience) DO UPDATE SET
       provider=EXCLUDED.provider, sender=EXCLUDED.sender, config_enc=EXCLUDED.config_enc, meta=EXCLUDED.meta,
       status=EXCLUDED.status, created_by=EXCLUDED.created_by, updated_at=now()
     RETURNING created_by, created_at, updated_at`,
    [randomUUID(), i.tenantId, i.channel, audience, i.provider, sender, encryptToken(JSON.stringify(config)), JSON.stringify(meta), i.createdBy ?? null, status]
  )
  invalidateTenantSenders(i.tenantId)
  const row = r.rows[0]
  return {
    channel: i.channel, audience, provider: i.provider, sender, meta, status,
    createdBy: row?.created_by ?? i.createdBy ?? null,
    createdAt: new Date(row?.created_at ?? Date.now()).toISOString(),
    updatedAt: new Date(row?.updated_at ?? Date.now()).toISOString(),
  }
}

/** Merge fields into a sender's `meta` (non-secret: WhatsApp registration state and the like). */
export async function updateSenderMeta(tenantId: string, channel: MessagingChannel, audience: SenderAudience, patch: Record<string, unknown>): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_messaging_senders SET meta = meta || $4::jsonb, updated_at = now() WHERE tenant_id=$1::uuid AND channel=$2 AND audience=$3`,
    [tenantId, channel, audience, JSON.stringify(patch)]
  )
  invalidateTenantSenders(tenantId)
}

/** Start sending from a row (active) or hold it back (pending: lookups skip it, so the audience falls back). */
export async function setTenantSenderStatus(tenantId: string, channel: MessagingChannel, audience: SenderAudience, status: 'active' | 'pending'): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenant_messaging_senders SET status = $4, updated_at = now() WHERE tenant_id=$1::uuid AND channel=$2 AND audience=$3`,
    [tenantId, channel, audience, status]
  )
  invalidateTenantSenders(tenantId)
}

/** Every pending WhatsApp row with a registered sender, across all tenants: the numbers waiting to go Online. */
export async function listPendingWhatsAppSenders(): Promise<{ tenantId: string; audience: SenderAudience; senderSid: string }[]> {
  const r = await controlPlanePool().query<{ tenant_id: string; audience: string; sid: string }>(
    `SELECT tenant_id::text, audience, meta->>'wa_sender_sid' AS sid FROM tenant_messaging_senders
      WHERE channel='whatsapp' AND status='pending' AND meta ? 'wa_sender_sid'`
  )
  return r.rows.flatMap(x => (isSenderAudience(x.audience) && x.sid ? [{ tenantId: x.tenant_id, audience: x.audience, senderSid: x.sid }] : []))
}

export async function deleteTenantSender(tenantId: string, channel: MessagingChannel, audience: SenderAudience = 'customer'): Promise<boolean> {
  if (!tenantId) return false
  const r = await controlPlanePool().query(
    `DELETE FROM tenant_messaging_senders WHERE tenant_id=$1::uuid AND channel=$2 AND audience=$3`,
    [tenantId, channel, audience]
  )
  invalidateTenantSenders(tenantId)
  return (r.rowCount ?? 0) > 0
}
