import { getRedisClient } from '@/lib/shared/redis'
import { getCurrentTenant } from '@/lib/tenancy/tenant-context'
import {
  HOMEPAGE_AUDIENCES,
  HOMEPAGE_PAGES,
  HOMEPAGE_SURFACES,
  sectionPlacement,
  sectionSide,
  visibleSections,
  withDefaults,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSection,
  type HomepageSurface,
  type SectionSide,
  type SectionType,
} from '@/lib/catalog/homepage-sections'

// The published layout boiled down to what a loading screen needs: section types, their column,
// and (listings) where they sit between the products. loading.tsx can't fetch the page's data, but
// it can read this: Redis (shared by the admin, storefront and business apps) holds one entry per
// tenant × page × audience, filled on first read and deleted when a homepage draft is published;
// a short in-process memo keeps the per-request cost at nothing. No entry yet → the built-in
// default layout, while the real one is computed in the background.

export interface LayoutSection {
  type: SectionType
  side: SectionSide
  /** Listing pages: products before it (sectionPlacement().after). */
  after?: number
}

export type SurfaceLayouts = Record<HomepageSurface, LayoutSection[]>

export interface PageLayout {
  /** The audience served: the business homepage falls back to the store's while unpublished. */
  audience: HomepageAudience
  surfaces: SurfaceLayouts
}

const VERSION = 'v1'
const REDIS_TTL_S = 15 * 60
const MEMO_TTL_MS = 15 * 1000

const memo = new Map<string, { value: PageLayout; expiresAt: number }>()
const pending = new Map<string, Promise<PageLayout>>()

/** One page's sections on one surface as the descriptor. */
export function layoutOf(sections: HomepageSection[], page: HomepagePage): LayoutSection[] {
  return sections.map(s => {
    const entry: LayoutSection = { type: s.type, side: sectionSide(s) }
    if (page !== 'home') entry.after = sectionPlacement(s).after
    return entry
  })
}

/** The layout a store with nothing published renders (homepage only; listings start empty). */
export function defaultLayout(page: HomepagePage): LayoutSection[] {
  return page === 'home' ? layoutOf(visibleSections(withDefaults([])), page) : []
}

async function tenantKey(): Promise<string> {
  const t = getCurrentTenant()
  if (t) return t.tenantId
  try {
    const { headers } = await import('next/headers')
    const slug = (await headers()).get('x-tenant-slug')
    return slug ? `slug:${slug}` : 'platform'
  } catch {
    return 'platform'
  }
}

const redisKey = (tenant: string, page: HomepagePage, audience: HomepageAudience) =>
  `homepage:layout:${VERSION}:${tenant}:${page}:${audience}`

async function compute(page: HomepagePage, audience: HomepageAudience): Promise<PageLayout> {
  const { resolvePageSections } = await import('@/lib/catalog/homepage-model')
  let served: HomepageAudience = 'store'
  const surfaces = {} as SurfaceLayouts
  for (const surface of HOMEPAGE_SURFACES) {
    const r = await resolvePageSections({ surface, page, audience })
    served = r.audience
    surfaces[surface] = layoutOf(r.sections, page)
  }
  return { audience: served, surfaces }
}

function parse(raw: string | null): PageLayout | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as PageLayout
    return v && v.surfaces && Array.isArray(v.surfaces.web) ? v : null
  } catch {
    return null
  }
}

async function fill(key: string, tenant: string, page: HomepagePage, audience: HomepageAudience): Promise<PageLayout> {
  let p = pending.get(key)
  if (!p) {
    p = compute(page, audience)
      .then(async value => {
        memo.set(key, { value, expiresAt: Date.now() + MEMO_TTL_MS })
        await getRedisClient()
          .set(redisKey(tenant, page, audience), JSON.stringify(value), 'EX', REDIS_TTL_S)
          .catch(() => {})
        return value
      })
      .finally(() => pending.delete(key))
    pending.set(key, p)
  }
  return p
}

/**
 * The published layout of a page for an audience, from the memo, then Redis. A miss returns the
 * default layout at once and fills the caches in the background (`wait` makes it wait instead).
 */
export async function getPageLayout(
  page: HomepagePage,
  audience: HomepageAudience = 'store',
  opts: { wait?: boolean } = {}
): Promise<PageLayout> {
  const tenant = await tenantKey()
  const key = `${tenant}:${page}:${audience}`
  const hit = memo.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.value
  const cached = parse(await getRedisClient().get(redisKey(tenant, page, audience)).catch(() => null))
  if (cached) {
    memo.set(key, { value: cached, expiresAt: Date.now() + MEMO_TTL_MS })
    return cached
  }
  const filling = fill(key, tenant, page, audience).catch(() => fallback(page))
  if (opts.wait) return filling
  return fallback(page)
}

function fallback(page: HomepagePage): PageLayout {
  const layout = defaultLayout(page)
  return { audience: 'store', surfaces: { web: layout, web_mobile: layout, app: layout } }
}

/** The sections a loading screen draws for a page on a surface, or null when the business homepage isn't published. */
export async function getLayoutSections(
  page: HomepagePage,
  audience: HomepageAudience,
  surface: HomepageSurface
): Promise<LayoutSection[] | null> {
  const layout = await getPageLayout(page, audience)
  if (audience === 'business' && layout.audience !== 'business') return null
  return layout.surfaces[surface] ?? layout.surfaces.web
}

/** After a publish: drops every page's entry for the current tenant so the next read recomputes. */
export async function invalidateHomepageLayoutCache(): Promise<void> {
  const tenant = await tenantKey()
  const redis = getRedisClient()
  for (const page of HOMEPAGE_PAGES) {
    for (const audience of HOMEPAGE_AUDIENCES) {
      memo.delete(`${tenant}:${page}:${audience}`)
      await redis.del(redisKey(tenant, page, audience)).catch(() => {})
    }
  }
}

/** Test seam. */
export function _resetHomepageLayoutMemo() {
  memo.clear()
  pending.clear()
}
