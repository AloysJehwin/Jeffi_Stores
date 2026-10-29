import { db } from '../db.js'
import { poolsForTenant } from '../pools.js'
import { PLATFORM_TENANT_ID } from '../templates-v2.js'

// Which provider carries a tenant's SMS / WhatsApp, as the app decides it (lib/providers/policy.ts): a
// tenant row in platform_provider_settings beats the platform default (tenant_id NULL); with neither,
// the store's own Site Controls choice (feature_*_provider); else Twilio. Any failure means Twilio.

export type MessagingProvider = 'twilio' | 'aws'
type Policy = { sms: MessagingProvider; whatsapp: MessagingProvider }

const TTL_MS = 30_000
const cache = new Map<string, { at: number; policy: Policy }>()
const valid = (v: unknown): MessagingProvider | undefined => (v === 'twilio' || v === 'aws' ? v : undefined)

export function invalidateProviderPolicy() {
  cache.clear()
}

// Site Controls live in the store's own DB; a workspace without one has no choice to make.
async function storeChoice(tenantId: string): Promise<Record<string, string>> {
  const found = await poolsForTenant(tenantId).catch(() => null)
  const store = found?.pools?.tenant
  if (!store || (tenantId !== PLATFORM_TENANT_ID && found!.pool === db)) return {}
  const r = await store
    .query<{ key: string; value: string | null }>(`SELECT key, value FROM site_settings WHERE key IN ('feature_sms_provider','feature_whatsapp_provider')`)
    .catch(() => null)
  return Object.fromEntries((r?.rows ?? []).map(x => [x.key, x.value ?? '']))
}

async function resolve(tenantId: string): Promise<Policy> {
  const hit = cache.get(tenantId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.policy
  let rows: { tenant_id: string | null; key: string; value: unknown }[] = []
  let ok = true
  try {
    rows = (await db.query<{ tenant_id: string | null; key: string; value: unknown }>(
      `SELECT tenant_id, key, value FROM platform_provider_settings
        WHERE key IN ('sms_provider','whatsapp_provider') AND (tenant_id IS NULL OR tenant_id = $1::uuid)`,
      [tenantId === PLATFORM_TENANT_ID ? null : tenantId])).rows
  } catch {
    ok = false // control plane unreachable: not cached, the next send retries
  }
  const pick = (key: string) =>
    valid(rows.find(r => r.tenant_id && r.key === key)?.value) ?? valid(rows.find(r => !r.tenant_id && r.key === key)?.value)
  let sms = pick('sms_provider')
  let whatsapp = pick('whatsapp_provider')
  if (!sms || !whatsapp) {
    const s = await storeChoice(tenantId)
    sms ??= s.feature_sms_provider === 'aws' ? 'aws' : undefined
    whatsapp ??= s.feature_whatsapp_provider === 'aws' ? 'aws' : undefined
  }
  const policy: Policy = { sms: sms ?? 'twilio', whatsapp: whatsapp ?? 'twilio' }
  if (ok) cache.set(tenantId, { at: Date.now(), policy })
  return policy
}

export async function messagingProvider(tenantId: string, channel: 'sms' | 'whatsapp'): Promise<MessagingProvider> {
  try {
    return (await resolve(tenantId))[channel]
  } catch {
    return 'twilio'
  }
}
