import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import type { ApiScope } from '@jeffi/api-contracts'

// API keys live in the control plane. Plaintext is shown once; only sha256 is stored.
export interface ApiKeyRow {
  id: string
  owner_id: string
  tenant_id: string
  tenant_slug: string
  service_types: string[]
  name: string
  key_prefix: string
  scopes: ApiScope[]
  rate_limit_per_min: number
  status: 'active' | 'revoked'
}

let pool: pg.Pool | undefined
export function cp(): pg.Pool {
  if (pool) return pool
  const url = process.env.CONTROL_PLANE_DATABASE_URL
  if (!url) throw new Error('CONTROL_PLANE_DATABASE_URL is not set')
  pool = new pg.Pool({ connectionString: url, max: 5 })
  return pool
}

export const hashKey = (plain: string) => createHash('sha256').update(plain).digest('hex')

/** `jk_live_` + 32 url-safe chars. Prefix (first 16) is what the dashboard lists. */
export function generateKey(): { plain: string; prefix: string; hash: string } {
  const plain = 'jk_live_' + randomBytes(24).toString('base64url')
  return { plain, prefix: plain.slice(0, 16), hash: hashKey(plain) }
}

const cache = new Map<string, { row: ApiKeyRow | null; at: number }>()
const TTL = 60_000

export async function lookupKey(plain: string): Promise<ApiKeyRow | null> {
  const h = hashKey(plain)
  const hit = cache.get(h)
  if (hit && Date.now() - hit.at < TTL) return hit.row
  const r = await cp().query<ApiKeyRow>(
    `SELECT k.id, k.owner_id, k.tenant_id, t.slug AS tenant_slug, t.service_types, k.name, k.key_prefix, k.scopes, k.rate_limit_per_min, k.status
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
      WHERE k.key_hash = $1`,
    [h]
  )
  const row = r.rows[0] && r.rows[0].status === 'active' ? r.rows[0] : null
  cache.set(h, { row, at: Date.now() })
  return row
}

export function touchKey(id: string, kind: 'messages' | 'documents' | null, spendPaise = 0) {
  cp()
    .query(
      `WITH u AS (UPDATE api_keys SET last_used_at = now() WHERE id = $1)
       INSERT INTO api_key_usage_daily (api_key_id, day, requests, messages, documents, spend_paise)
       VALUES ($1, CURRENT_DATE, 1, $2, $3, $4)
       ON CONFLICT (api_key_id, day) DO UPDATE SET requests = api_key_usage_daily.requests + 1,
         messages = api_key_usage_daily.messages + EXCLUDED.messages,
         documents = api_key_usage_daily.documents + EXCLUDED.documents,
         spend_paise = api_key_usage_daily.spend_paise + EXCLUDED.spend_paise`,
      [id, kind === 'messages' ? 1 : 0, kind === 'documents' ? 1 : 0, spendPaise]
    )
    .catch(() => {})
}
