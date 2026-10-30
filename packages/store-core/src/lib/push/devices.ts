import { query, queryMany, queryOne } from '@/lib/shared/db'

// App installs that can receive a push (push_devices). A token belongs to one install; user_id is
// NULL while the install is signed out. The users FK may be missing on prod (schema-diff), so reads
// join users instead of trusting it.

export type PushPlatform = 'android' | 'ios'

export interface DeviceInput {
  token: string
  platform: PushPlatform
  appVersion?: string | null
  osVersion?: string | null
  locale?: string | null
  timezone?: string | null
  /** The install's own marketing consent (signed-out soft ask); undefined leaves it as is. */
  offersOptIn?: boolean
}

export interface DeviceRow {
  id: string
  user_id: string | null
  offers_opt_in: boolean
}

/**
 * Upsert by token: attach the signed-in user (a signed-out call keeps the current owner; sign-out
 * detaches explicitly), bump last_seen_at, and re-enable a token FCM had rejected, since the app is
 * presenting it as current.
 */
export async function registerDevice(d: DeviceInput, userId: string | null): Promise<DeviceRow | null> {
  return queryOne<DeviceRow>(
    `INSERT INTO push_devices (user_id, token, platform, app_version, os_version, locale, timezone, offers_opt_in, offers_opt_in_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'Asia/Kolkata'), COALESCE($8::boolean, false), CASE WHEN $8::boolean IS NOT NULL THEN now() END)
     ON CONFLICT (token) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, push_devices.user_id),
       platform = EXCLUDED.platform,
       app_version = COALESCE(EXCLUDED.app_version, push_devices.app_version),
       os_version = COALESCE(EXCLUDED.os_version, push_devices.os_version),
       locale = COALESCE(EXCLUDED.locale, push_devices.locale),
       timezone = COALESCE($7, push_devices.timezone),
       offers_opt_in = COALESCE($8::boolean, push_devices.offers_opt_in),
       offers_opt_in_at = CASE WHEN $8::boolean IS DISTINCT FROM push_devices.offers_opt_in AND $8::boolean IS NOT NULL
                               THEN now() ELSE push_devices.offers_opt_in_at END,
       last_seen_at = now(),
       disabled_at = NULL,
       disabled_reason = NULL
     RETURNING id, user_id, offers_opt_in`,
    [
      userId,
      d.token,
      d.platform,
      d.appVersion ?? null,
      d.osVersion ?? null,
      d.locale ?? null,
      d.timezone ?? null,
      d.offersOptIn ?? null,
    ]
  )
}

/** Sign-out: the install stays registered as a guest. Holding the token is proof enough. */
export async function detachDevice(token: string): Promise<void> {
  await query(`UPDATE push_devices SET user_id = NULL, last_seen_at = now() WHERE token = $1`, [token])
}

/** Live tokens for a user, newest install first. */
export async function activeTokens(userId: string): Promise<string[]> {
  const rows = await queryMany<{ token: string }>(
    `SELECT d.token FROM push_devices d
     JOIN users u ON u.id = d.user_id AND u.is_active IS NOT FALSE
     WHERE d.user_id = $1 AND d.disabled_at IS NULL
     ORDER BY d.last_seen_at DESC
     LIMIT 20`,
    [userId]
  )
  return rows.map(r => r.token)
}

export async function disableTokens(tokens: string[], reason: string): Promise<void> {
  if (!tokens.length) return
  await query(
    `UPDATE push_devices SET disabled_at = now(), disabled_reason = $2 WHERE token = ANY($1::text[]) AND disabled_at IS NULL`,
    [tokens, reason.slice(0, 64)]
  )
}

/** Weekly prune: installs not seen for `days` (uninstalled, or never reopened). */
export async function pruneDevices(days = 270): Promise<number> {
  const r = await query(`DELETE FROM push_devices WHERE last_seen_at < now() - make_interval(days => $1)`, [days])
  return r.rowCount ?? 0
}
