import 'server-only'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { createShowcaseDraft, getShowcaseByOwner, updateShowcase, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { setShowcaseSlug } from '@/lib/showcase/builder-data'
import { cleanBusiness, cleanContent } from '@/lib/showcase/clean'
import type { ShowcaseView } from '@/lib/showcase/types'

// The owner's Showcase as the builder (signup and dashboard editor) works on it: the newest site row, created as a
// draft by the first save of the Details step.

export type SaveResult = { ok: true; site: ShowcaseSiteRow } | { ok: false; error: string; field?: 'slug' | 'name' }

export const ownerShowcase = (ownerId: string) => getShowcaseByOwner(ownerId)

/** The workspace a new Showcase joins (its wallet pays for hosting and paid generations): the owner's active one. */
async function ownerWorkspace(ownerId: string): Promise<string | null> {
  const tenants = (await getOwnerTenants(ownerId).catch(() => [])).filter(t => t.status !== 'terminated')
  return tenants.find(t => t.status === 'active')?.id ?? null
}

/**
 * The Details step (or the editor's forms) saved: the draft is created on the first save that has a name and an
 * address, then updated. `content` is left as it is when not sent. A draft's address may change; a live site's not.
 */
export async function saveShowcaseDetails(ownerId: string, input: { slug?: unknown; business?: unknown; content?: unknown }): Promise<SaveResult> {
  const site = await getShowcaseByOwner(ownerId)
  const content = input.content === undefined ? undefined : cleanContent(input.content)
  if (input.business === undefined && site) return content ? done(await updateShowcase(site.id, { content })) : { ok: true, site }
  const business = cleanBusiness(input.business)
  if (!site) {
    if (business.name.length < 2) return { ok: false, error: 'Give your business a name.', field: 'name' }
    const created = await createShowcaseDraft({ ownerId, tenantId: await ownerWorkspace(ownerId), slug: String(input.slug ?? ''), business, content })
    return created.ok ? created : { ...created, field: 'slug' }
  }
  // The details save even when the new address can't be taken; the answer says why it wasn't.
  const saved = await updateShowcase(site.id, { business, ...(content ? { content } : {}) })
  if (!saved) return done(null)
  if (typeof input.slug === 'string' && input.slug.trim() && input.slug.trim().toLowerCase() !== saved.slug) {
    const moved = await setShowcaseSlug(saved.id, input.slug)
    return moved.ok ? moved : { ...moved, field: 'slug' }
  }
  return { ok: true, site: saved }
}

const done = (site: ShowcaseSiteRow | null): SaveResult => (site ? { ok: true, site } : { ok: false, error: 'Your site could not be found. Reload the page.' })

/** What the page's parts read while the owner designs it: the draft's details and content, forms inert. */
export const previewView = (site: Pick<ShowcaseSiteRow, 'business' | 'content'>): ShowcaseView => ({ business: site.business, content: site.content, leadEndpoint: null })

/** What the builder's client gets of a site (no billing internals). */
export function siteForClient(site: ShowcaseSiteRow | null) {
  if (!site) return null
  return {
    id: site.id,
    slug: site.slug,
    status: site.status,
    business: site.business,
    content: site.content,
    hasPage: !!site.page,
    tenantId: site.tenantId,
    publishedAt: site.publishedAt,
    paidUntil: site.paidUntil,
    freeGenerationUsedAt: site.freeGenerationUsedAt,
    generations: site.generations,
    updatedAt: site.updatedAt,
  }
}
export type ClientSite = NonNullable<ReturnType<typeof siteForClient>>
