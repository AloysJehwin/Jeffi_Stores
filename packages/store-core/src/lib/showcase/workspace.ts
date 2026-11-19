import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { createTenant, slugFromName } from '@/lib/tenant-registry/tenants'
import { getOwnerTenants, linkOwnerTenant } from '@/lib/tenant-registry/owners'
import type { ShowcaseSite } from './types'

/**
 * The workspace a published Showcase is billed to and managed from (the console and the wallet need one): the owner's
 * active workspace, else a new Showcase-only one on the free `services` plan, as a Messaging/Documents signup gets
 * (active at once, the welcome wallet credit, no store), named after the business. Null when none could be made.
 */
export async function ensureShowcaseWorkspace(site: Pick<ShowcaseSite, 'id' | 'ownerId' | 'slug' | 'tenantId' | 'business'>): Promise<string | null> {
  if (site.tenantId) return site.tenantId
  let tenantId = (await getOwnerTenants(site.ownerId)).find(t => t.status === 'active')?.id ?? null
  if (!tenantId) {
    const name = site.business.name?.trim() || site.slug
    const rand = () => Math.random().toString(36).slice(2, 8)
    // From the business name, never the site address: a browser can autofill a street address into that field.
    // A store slug may not start with site- nor clash with another workspace.
    const base = slugFromName(site.business.name ?? '')
    for (const slug of [...(base ? [base, `${base}-${rand()}`] : []), `showcase-${rand()}`]) {
      const r = await createTenant({ slug, displayName: name, planSlug: 'services', status: 'active', serviceTypes: ['showcase'] })
      if (!r.ok) continue
      tenantId = r.tenantId
      await linkOwnerTenant(site.ownerId, tenantId)
      break
    }
  }
  if (!tenantId) return null
  const pool = controlPlanePool()
  await pool.query(`UPDATE showcase_sites SET tenant_id = $2, updated_at = now() WHERE id = $1 AND tenant_id IS NULL`, [site.id, tenantId])
  await pool.query(
    `UPDATE tenants SET service_types = (SELECT array_agg(DISTINCT x) FROM unnest(service_types || '{showcase}'::text[]) x), updated_at = now()
      WHERE id = $1 AND NOT ('showcase' = ANY(service_types))`,
    [tenantId]
  )
  return tenantId
}
