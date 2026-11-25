import { createHash } from 'crypto'
import { normalizeDoc, topBlocks, type PageDoc } from '@jeffi/site-blocks'
import { checkShowcasePreviewToken } from '@/lib/showcase/preview-token'
import { showcaseSlugFromHost } from '@/lib/showcase/host'
import { getShowcaseById, type ShowcaseSiteRow } from '@/lib/showcase/store'

// The no-login preview (/preview?t=<token>): the token's own site, read fresh from its row (never the host cache, so
// a draft shows), and only on that site's host. Read-only.

export type PreviewLoad =
  | { kind: 'ok'; site: ShowcaseSiteRow; expiresAt: string }
  /** Expired or revoked: the token's site, so the page can send the visitor to it when it is live. */
  | { kind: 'expired'; site: ShowcaseSiteRow }
  | { kind: 'invalid' }

const bare = (host: string) => host.toLowerCase().split(':')[0].trim()

/** Whether this host serves the site: its site-{slug} address, or its custom domain (and its www.). */
export function siteServesHost(site: Pick<ShowcaseSiteRow, 'slug' | 'customDomain'>, host: string): boolean {
  const h = bare(host)
  if (!h) return false
  const slug = showcaseSlugFromHost(h)
  if (slug) return slug === site.slug
  const domain = site.customDomain?.toLowerCase()
  return !!domain && (h === domain || h === `www.${domain}`)
}

/** Its address serves the published page now. */
export const servedLive = (site: ShowcaseSiteRow) => site.status === 'live' && !site.workspaceSuspended

export async function loadPreview(token: string | null | undefined, host: string): Promise<PreviewLoad> {
  const check = await checkShowcasePreviewToken(token).catch(() => ({ state: 'invalid' as const }))
  if (check.state === 'invalid') return { kind: 'invalid' }
  const site = await getShowcaseById(check.siteId).catch(() => null)
  if (!site || !siteServesHost(site, host)) return { kind: 'invalid' }
  if (check.state !== 'valid' || site.workspaceSuspended) return { kind: 'expired', site }
  return { kind: 'ok', site, expiresAt: check.expiresAt }
}

/** A short hash of each section on the page, by block id: the poller tells from them which sections changed. */
export function sectionHashes(page: PageDoc | null): Record<string, string> {
  if (!page) return {}
  const out: Record<string, string> = {}
  for (const b of topBlocks(normalizeDoc(page))) {
    if (b.type !== 'code_section' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id)) continue
    out[b.id] = createHash('sha256').update(JSON.stringify(b.props ?? null)).digest('hex').slice(0, 16)
  }
  return out
}

export interface PreviewState {
  /** Changes whenever the site row does. */
  version: string
  status: ShowcaseSiteRow['status']
  live: boolean
  expiresAt: string
  sections: Record<string, string>
}

export const previewState = (site: ShowcaseSiteRow, expiresAt: string): PreviewState => ({
  version: site.updatedAt,
  status: site.status,
  live: servedLive(site),
  expiresAt,
  sections: sectionHashes(site.page),
})
