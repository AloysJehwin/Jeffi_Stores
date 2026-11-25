import type { NextRequest } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { ATTRIBUTION_COOKIE, decodeAttribution, type Attribution } from './capture'

// Saves the attribution cookie with the owner, once, when the owner is created or first signs in: an existing
// owner_attribution row is never replaced. A returning owner who had signed up long before the ad (older than
// NEW_OWNER_WINDOW_MS) is not attributed to it.

export const NEW_OWNER_WINDOW_MS = 24 * 60 * 60 * 1000

interface Pool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

/** The attribution a request carries, or null. */
export const attributionFromRequest = (req: Pick<NextRequest, 'cookies'>): Attribution | null =>
  decodeAttribution(req.cookies.get(ATTRIBUTION_COOKIE)?.value)

/** True when this call saved the owner's attribution (so a signup conversion is owed when it has a click id). */
export async function saveOwnerAttribution(
  owner: { id: string; created_at?: Date | string | null },
  a: Attribution | null,
  opts: { pool?: Pool; now?: Date } = {}
): Promise<boolean> {
  if (!a) return false
  const now = opts.now ?? new Date()
  const createdAt = owner.created_at ? new Date(owner.created_at).getTime() : now.getTime()
  if (now.getTime() - createdAt > NEW_OWNER_WINDOW_MS) return false
  const pool = opts.pool ?? controlPlanePool()
  const r = await pool.query(
    `INSERT INTO owner_attribution (owner_id, gclid, gbraid, wbraid, utm, landing_path, first_seen_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (owner_id) DO NOTHING`,
    [owner.id, a.gclid ?? null, a.gbraid ?? null, a.wbraid ?? null, JSON.stringify(a.utm ?? {}), a.landingPath ?? null, a.seenAt]
  )
  return (r.rowCount ?? 0) > 0
}

/** After an owner is created or signs in: save the ad attribution once and queue the signup conversion. */
export async function recordOwnerSignIn(
  owner: { id: string; created_at?: Date | string | null },
  req: Pick<NextRequest, 'cookies'>
): Promise<void> {
  const a = attributionFromRequest(req)
  if (!(await saveOwnerAttribution(owner, a))) return
  const { enqueueOwnerConversion } = await import('@controller/lib/google-ads/ecom-conversions')
  await enqueueOwnerConversion(owner.id, 'ecom_signup')
}
