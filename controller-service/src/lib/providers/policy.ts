import { controlPlanePool } from '@/lib/tenant-registry'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

// Which provider serves SMS, WhatsApp and AI for a store. Set only by the platform admin
// (flagship Site Controls, Providers card) in control-plane platform_provider_settings: a tenant row overrides the
// platform default (tenant_id NULL); with neither, behaviour is unchanged (the store's old Site
// Controls messaging choice, the gateway's own AI order).

export const MESSAGING_PROVIDERS = ['twilio', 'aws'] as const
export const AI_TEXT_PROVIDERS = ['razer'] as const
export const AI_IMAGE_PROVIDERS = ['razer', 'google', 'replicate'] as const
export const AI_VIDEO_PROVIDERS = ['google', 'replicate'] as const
export const AI_IMAGE_QUALITIES = ['draft', 'standard', 'premium'] as const

export type MessagingProviderName = (typeof MESSAGING_PROVIDERS)[number]
export type AiTextProvider = (typeof AI_TEXT_PROVIDERS)[number]
export type AiImageProvider = (typeof AI_IMAGE_PROVIDERS)[number]
export type AiVideoProvider = (typeof AI_VIDEO_PROVIDERS)[number]
export type AiImageQuality = (typeof AI_IMAGE_QUALITIES)[number]

export const PROVIDER_SETTING_KEYS = [
  'sms_provider',
  'whatsapp_provider',
  'ai_text_providers',
  'ai_image_providers',
  'ai_video_providers',
  'ai_image_default_quality',
] as const
export type ProviderSettingKey = (typeof PROVIDER_SETTING_KEYS)[number]
export type PolicySource = 'tenant' | 'platform' | 'fallback'

export interface ProviderPolicy {
  smsProvider: MessagingProviderName
  whatsappProvider: MessagingProviderName
  /** Empty = the gateway's default order. */
  aiTextProviders: AiTextProvider[]
  aiImageProviders: AiImageProvider[]
  aiVideoProviders: AiVideoProvider[]
  aiImageDefaultQuality?: AiImageQuality
  source: Record<ProviderSettingKey, PolicySource>
}

export interface AiRouting {
  text?: string[]
  image?: string[]
  video?: string[]
}

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const TTL_MS = 30_000

type Rows = { tenant: Map<string, unknown>; platform: Map<string, unknown> }
const cache = new Map<string, { at: number; rows: Rows }>()

export function invalidateProviderPolicy(): void {
  cache.clear()
}

const asTenant = (id: string | null | undefined) => (id && id !== PLATFORM_TENANT_ID ? id : null)

function orderOf<T extends string>(v: unknown, allow: readonly T[]): T[] | null {
  if (!Array.isArray(v)) return null
  const out: T[] = []
  for (const p of v) {
    if (typeof p !== 'string' || !allow.includes(p as T)) return null
    if (!out.includes(p as T)) out.push(p as T)
  }
  return out
}

/** Validates a value for a key; null when invalid. Arrays are de-duplicated, order kept. */
export function normalizeProviderValue(key: ProviderSettingKey, v: unknown): unknown | null {
  switch (key) {
    case 'sms_provider':
    case 'whatsapp_provider':
      return MESSAGING_PROVIDERS.includes(v as MessagingProviderName) ? v : null
    case 'ai_text_providers':
      return orderOf(v, AI_TEXT_PROVIDERS)
    case 'ai_image_providers':
      return orderOf(v, AI_IMAGE_PROVIDERS)
    case 'ai_video_providers':
      return orderOf(v, AI_VIDEO_PROVIDERS)
    case 'ai_image_default_quality':
      return AI_IMAGE_QUALITIES.includes(v as AiImageQuality) ? v : null
  }
}

async function loadRows(tenantId: string | null): Promise<Rows> {
  const k = tenantId ?? 'platform'
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows
  const rows: Rows = { tenant: new Map(), platform: new Map() }
  try {
    const r = await controlPlanePool().query<{ tenant_id: string | null; key: string; value: unknown }>(
      `SELECT tenant_id, key, value FROM platform_provider_settings
        WHERE tenant_id IS NULL OR tenant_id = $1::uuid`,
      [tenantId]
    )
    for (const row of r.rows) (row.tenant_id ? rows.tenant : rows.platform).set(row.key, row.value)
    cache.set(k, { at: Date.now(), rows })
  } catch {
    // Control plane unreachable: current behaviour, not cached, so the next call retries.
  }
  return rows
}

/**
 * Resolved provider policy. Without tenantId it uses the current request's store (the flagship has
 * no override, only the platform default) and falls back to that store's old Site Controls messaging
 * choice; with an explicit tenantId the messaging fallback is Twilio.
 */
export async function getProviderPolicy(tenantId?: string | null): Promise<ProviderPolicy> {
  const current = tenantId === undefined
  const tid = asTenant(current ? await resolveTenantId().catch(() => null) : tenantId)
  const rows = await loadRows(tid)
  const source = {} as Record<ProviderSettingKey, PolicySource>

  const pick = <T>(key: ProviderSettingKey): T | undefined => {
    for (const [scope, map] of [['tenant', rows.tenant], ['platform', rows.platform]] as const) {
      if (!map.has(key)) continue
      const v = normalizeProviderValue(key, map.get(key))
      if (v !== null) {
        source[key] = scope
        return v as T
      }
    }
    source[key] = 'fallback'
    return undefined
  }

  let sms = pick<MessagingProviderName>('sms_provider')
  let wa = pick<MessagingProviderName>('whatsapp_provider')
  if ((!sms || !wa) && current) {
    const flags = await getFeatureFlags().catch(() => null)
    sms ??= flags?.smsProvider === 'aws' ? 'aws' : undefined
    wa ??= flags?.whatsappProvider === 'aws' ? 'aws' : undefined
  }

  return {
    smsProvider: sms ?? 'twilio',
    whatsappProvider: wa ?? 'twilio',
    aiTextProviders: pick<AiTextProvider[]>('ai_text_providers') ?? [],
    aiImageProviders: pick<AiImageProvider[]>('ai_image_providers') ?? [],
    aiVideoProviders: pick<AiVideoProvider[]>('ai_video_providers') ?? [],
    aiImageDefaultQuality: pick<AiImageQuality>('ai_image_default_quality'),
    source,
  }
}

/** Gateway `providers` order per capability; a capability is omitted when the gateway default applies. */
export async function getAiRouting(tenantId?: string | null): Promise<AiRouting> {
  const p = await getProviderPolicy(tenantId)
  const out: AiRouting = {}
  if (p.aiTextProviders.length) out.text = p.aiTextProviders
  if (p.aiImageProviders.length) out.image = p.aiImageProviders
  if (p.aiVideoProviders.length) out.video = p.aiVideoProviders
  return out
}

export interface ProviderSettingRow {
  tenant_id: string | null
  key: ProviderSettingKey
  value: unknown
  updated_by: string | null
  updated_at: string
}

export async function listProviderSettings(): Promise<ProviderSettingRow[]> {
  const r = await controlPlanePool().query<ProviderSettingRow>(
    `SELECT tenant_id, key, value, updated_by, updated_at FROM platform_provider_settings
      ORDER BY tenant_id NULLS FIRST, key`
  )
  return r.rows
}

/** Upsert; tenantId null = platform default. Caller validates with normalizeProviderValue. */
export async function setProviderSetting(
  tenantId: string | null,
  key: ProviderSettingKey,
  value: unknown,
  updatedBy: string | null
): Promise<void> {
  await controlPlanePool().query(
    `INSERT INTO platform_provider_settings (tenant_id, key, value, updated_by)
     VALUES ($1::uuid, $2, $3::jsonb, $4)
     ON CONFLICT ((COALESCE(tenant_id, '${PLATFORM_TENANT_ID}'::uuid)), key)
     DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [asTenant(tenantId), key, JSON.stringify(value), updatedBy]
  )
  invalidateProviderPolicy()
}

export async function clearProviderSetting(tenantId: string | null, key: ProviderSettingKey): Promise<boolean> {
  const t = asTenant(tenantId)
  const r = await controlPlanePool().query(
    `DELETE FROM platform_provider_settings
      WHERE key = $2 AND ${t ? 'tenant_id = $1::uuid' : 'tenant_id IS NULL AND $1::uuid IS NULL'}`,
    [t, key]
  )
  invalidateProviderPolicy()
  return (r.rowCount ?? 0) > 0
}
