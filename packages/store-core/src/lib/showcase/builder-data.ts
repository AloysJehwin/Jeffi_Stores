import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { checkShowcaseSlug, getShowcaseById, type ShowcaseSiteRow } from './store'

// What the Showcase builder (the signup flow and the dashboard editor) needs beyond store.ts.

/**
 * A draft's new address. Only while it is a draft: a published site keeps its address (links and QR codes point at
 * it). The same slug is a no-op.
 */
export async function setShowcaseSlug(siteId: string, raw: string): Promise<{ ok: true; site: ShowcaseSiteRow } | { ok: false; error: string }> {
  const current = await getShowcaseById(siteId)
  if (!current) return { ok: false, error: 'Site not found.' }
  const want = (raw || '').toLowerCase().trim()
  if (want === current.slug) return { ok: true, site: current }
  if (current.status !== 'draft') return { ok: false, error: 'The address of a published site cannot change.' }
  const check = await checkShowcaseSlug(want)
  if (!check.ok) return check
  try {
    await controlPlanePool().query(`UPDATE showcase_sites SET slug = $2, updated_at = now() WHERE id = $1 AND status = 'draft'`, [siteId, check.slug])
  } catch (e: any) {
    if (e?.code === '23505') return { ok: false, error: `site-${check.slug} is already taken.` }
    throw e
  }
  const site = await getShowcaseById(siteId)
  return site ? { ok: true, site } : { ok: false, error: 'Site not found.' }
}
