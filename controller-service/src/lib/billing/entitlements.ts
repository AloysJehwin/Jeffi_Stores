import 'server-only'
import type { PoolClient } from 'pg'
import { controlPlanePool } from '@/lib/tenant-registry'
import { invalidateMessagingEntitlement } from '@/lib/billing/messaging-addon'
import type { BillingLine } from './lines'

// The only writer of tenants.ad_free_until, messaging_addon(_until) and showcase_sites.paid_until. Readers
// (storeIsAdFree, messagingEntitlement, resumeShowcase) are unchanged. Dates only move forward.

type Q = Pick<PoolClient, 'query'>

/** Extends each line's entitlement to `until`; a site paused for non-payment goes live again. Returns those sites. */
export async function extendEntitlements(tenantId: string, lines: readonly BillingLine[], until: Date, client?: Q): Promise<string[]> {
  const c = client ?? controlPlanePool()
  const at = until.toISOString()
  const resumed: string[] = []
  for (const l of lines) {
    if (l.kind === 'ad_free') {
      await c.query(`UPDATE tenants SET ad_free_until = GREATEST(COALESCE(ad_free_until, $2::timestamptz), $2::timestamptz), updated_at = now() WHERE id = $1`, [tenantId, at])
    } else if (l.kind === 'messaging_addon') {
      await c.query(
        `UPDATE tenants SET messaging_addon = $3::text,
                messaging_addon_until = CASE WHEN messaging_addon = $3::text THEN GREATEST(COALESCE(messaging_addon_until, $2::timestamptz), $2::timestamptz) ELSE $2::timestamptz END,
                updated_at = now()
          WHERE id = $1`,
        [tenantId, at, l.ref || 'both']
      )
      invalidateMessagingEntitlement(tenantId)
    } else if (l.kind === 'showcase_site') {
      const r = await c.query<{ id: string; was: string }>(
        `UPDATE showcase_sites s SET paid_until = GREATEST(COALESCE(s.paid_until, $2::timestamptz), $2::timestamptz),
                status = CASE WHEN s.status = 'paused' AND s.pause_reason = 'unpaid' AND s.page IS NOT NULL THEN 'live' ELSE s.status END,
                pause_reason = CASE WHEN s.status = 'paused' AND s.pause_reason = 'unpaid' AND s.page IS NOT NULL THEN NULL ELSE s.pause_reason END,
                updated_at = now()
           FROM (SELECT id, status AS was, pause_reason AS why FROM showcase_sites WHERE id::text = $1 AND tenant_id = $3) old
          WHERE s.id = old.id RETURNING s.id::text, (old.was || ':' || COALESCE(old.why, '')) AS was`,
        [l.ref, at, tenantId]
      )
      if (r.rows[0]?.was === 'paused:unpaid') resumed.push(r.rows[0].id)
    }
  }
  return resumed
}
