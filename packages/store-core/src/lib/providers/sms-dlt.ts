import { controlPlanePool } from '@/lib/tenant-registry'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { normalizeDltEntityId, normalizeSenderIds } from './voice-settings'

// India SMS DLT ids (Airtel DLT): the Principal Entity ID and the approved sender headers. Each one resolves
// from the store's override row, then the platform default (platform_provider_settings), then the env
// (AWS_SMS_DLT_ENTITY_ID, AWS_SMS_DLT_SENDER_IDS comma-separated). A template's DLT template ID is set on the template.

export type DltSource = 'tenant' | 'platform' | 'env' | 'none'

export interface SmsDltConfig {
  entityId: string | null
  senderIds: string[]
  source: { entityId: DltSource; senderIds: DltSource }
}

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: SmsDltConfig }>()

export function invalidateSmsDltConfig(): void {
  cache.clear()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `tenantId` undefined = the current request's store; null or the platform id = the platform default.
 *  `fresh` skips the 30-second cache (the admin screen). */
export async function getSmsDltConfig(tenantId?: string | null, opts: { fresh?: boolean } = {}): Promise<SmsDltConfig> {
  const raw = tenantId === undefined ? await resolveTenantId().catch(() => null) : tenantId
  const tid = raw && raw !== PLATFORM_TENANT_ID && UUID.test(raw) ? raw : null
  const k = tid ?? 'platform'
  const hit = cache.get(k)
  if (hit && !opts.fresh && Date.now() - hit.at < TTL_MS) return hit.value

  const tenant = new Map<string, unknown>()
  const platform = new Map<string, unknown>()
  let fromDb = true
  try {
    const r = await controlPlanePool().query<{ tenant_id: string | null; key: string; value: unknown }>(
      `SELECT tenant_id, key, value FROM platform_provider_settings
        WHERE key IN ('sms_dlt_entity_id', 'sms_dlt_sender_ids') AND (tenant_id IS NULL OR tenant_id = $1::uuid)`,
      [tid]
    )
    for (const row of r.rows) (row.tenant_id ? tenant : platform).set(row.key, row.value)
  } catch {
    fromDb = false // control plane unreachable: env only, not cached
  }

  const pick = <T>(key: string, norm: (v: unknown) => T | null): [T | null, DltSource] => {
    for (const [scope, m] of [['tenant', tenant], ['platform', platform]] as const) {
      const v = m.has(key) ? norm(m.get(key)) : null
      if (v !== null) return [v, scope]
    }
    return [null, 'none']
  }

  let [entityId, entitySrc] = pick('sms_dlt_entity_id', normalizeDltEntityId)
  if (!entityId) {
    entityId = normalizeDltEntityId(process.env.AWS_SMS_DLT_ENTITY_ID ?? '')
    entitySrc = entityId ? 'env' : 'none'
  }
  let [senderIds, senderSrc] = pick('sms_dlt_sender_ids', normalizeSenderIds)
  if (!senderIds) {
    const env = (process.env.AWS_SMS_DLT_SENDER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    senderIds = env.length ? normalizeSenderIds(env) : null
    senderSrc = senderIds ? 'env' : 'none'
  }

  const value: SmsDltConfig = { entityId, senderIds: senderIds ?? [], source: { entityId: entitySrc, senderIds: senderSrc } }
  if (fromDb) cache.set(k, { at: Date.now(), value })
  return value
}
