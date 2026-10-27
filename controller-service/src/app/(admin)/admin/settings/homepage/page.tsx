import Link from 'next/link'
import { Lock } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import HeroSlideManager from '@/components/admin/HeroSlideManager'
import HomepageSectionManager from '@/components/admin/homepage/HomepageSectionManager'
import HomepageFormFooter from '@/components/admin/homepage/HomepageFormFooter'
import { HomepageLockBanner, HomepageLockProvider } from '@/components/admin/homepage/HomepageLock'
import { HOMEPAGE_LOCK_ID, initialDraftLock } from '@/lib/admin/draft-locks'
import { getStorefrontContent, getStoreIdentity } from '@/lib/catalog/site-controls'
import {
  HOMEPAGE_AUDIENCES,
  HOMEPAGE_PAGES,
  HOMEPAGE_SURFACES,
  defaultAboutCopy,
  resolveAboutStats,
  rowAudience,
  rowPage,
  rowSurface,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSurface,
  type SectionType,
} from '@/lib/catalog/homepage-sections'
import { getHomepagePlan, planName } from '@/lib/catalog/homepage-plan'
import { getEditableHomepage, getHomepageDraftSummary, type DraftDiff } from '@/lib/catalog/homepage-draft'
import type { SectionOptions } from '@/components/admin/homepage/editors/fields'
import { Badge, PageHeader, TabLinks } from '@/components/admin/kit'
import { resnapshotHomepageSession } from './actions'

const PAGE_COPY: Record<HomepagePage, { tab: string; description: string }> = {
  home: {
    tab: 'Home',
    description:
      'Everything on the homepage, in the order it appears. Drag to reorder, toggle to hide, and expand a section to edit it. Hero slides are edited inside the Hero section; offer slides inside the Offer Slider section. Changes are saved as a draft and go live only when you publish.',
  },
  products: {
    tab: 'All products',
    description:
      'Sections shown between the products on the all-products page. Each one appears after the number of products you set, and can repeat further down. Changes are saved as a draft and go live only when you publish.',
  },
  category: {
    tab: 'Category pages',
    description:
      'Sections shown between the products on every category page. Each one appears after the number of products you set, and can repeat further down. Changes are saved as a draft and go live only when you publish.',
  },
  brand: {
    tab: 'Brand pages',
    description:
      'Sections shown between the products on every brand page. Each one appears after the number of products you set, and can repeat further down. Changes are saved as a draft and go live only when you publish.',
  },
}

const BUSINESS_DESCRIPTION =
  'The homepage business accounts see at /business and on the business store in the app. Drag to reorder, toggle to hide, and expand a section to edit it. Until it has sections of its own it shows the store homepage. Changes are saved as a draft and go live only when you publish.'

const AUDIENCE_TAB: Record<HomepageAudience, string> = { store: 'Store', business: 'Business' }

const SURFACE_TAB: Record<HomepageSurface, string> = { web: 'Desktop web', web_mobile: 'Mobile web', app: 'App' }

// Phone browsers and the app use the desktop layout until they have sections of their own.
const SURFACE_NOTE: Record<HomepageSurface, string> = {
  web: 'Desktop and tablet browsers.',
  web_mobile: 'Phone browsers. Until this layout has sections of its own it shows the desktop layout.',
  app: 'The mobile app. Until this layout has sections of its own it shows the desktop layout.',
}

const changed = (d: DraftDiff) => d.added + d.removed + d.edited + (d.reordered ? 1 : 0) > 0

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function loadHeroData() {
  const [cats, brands, grades, materials] = await Promise.all([
    queryMany<{ slug: string; name: string }>(
      `SELECT slug, name FROM categories WHERE is_active = true AND slug IS NOT NULL ORDER BY name`
    ),
    queryMany<{ id: string; name: string }>(`SELECT id, name FROM brands WHERE is_active = true ORDER BY name`),
    queryMany<{ grade: string }>(
      `SELECT DISTINCT grade FROM products WHERE grade IS NOT NULL AND grade != '' AND is_active = true ORDER BY grade`
    ),
    queryMany<{ material: string }>(
      `SELECT DISTINCT material FROM products WHERE material IS NOT NULL AND material != '' AND is_active = true ORDER BY material`
    ),
  ])
  return {
    categoryOptions: cats.map(c => ({ value: c.slug, label: c.name })),
    brandOptions: brands.map(b => ({ value: b.id, label: b.name })),
    gradeOptions: grades.map(g => ({ value: g.grade, label: g.grade })),
    materialOptions: materials.map(m => ({ value: m.material, label: m.material })),
  }
}

async function loadSectionOptions(
  categories: { value: string; label: string }[],
  brands: { value: string; label: string }[]
): Promise<SectionOptions> {
  const [storefront, identity] = await Promise.all([getStorefrontContent(), getStoreIdentity()])
  const counts = await queryOne<{
    featured: string
    new_arrivals: string
    best_sellers: string
    on_sale: string
    bundles: string
    approved_reviews: string
  }>(
    `SELECT
       count(*) FILTER (WHERE is_featured = true)          AS featured,
       count(*)                                            AS new_arrivals,
       count(*)                                            AS best_sellers,
       count(*) FILTER (WHERE mrp IS NOT NULL AND mrp > base_price) AS on_sale,
       count(*) FILTER (WHERE is_bundle = true)            AS bundles,
       (SELECT count(*) FROM product_reviews WHERE is_approved = true) AS approved_reviews
     FROM products WHERE is_active = true`
  ).catch(() => null)
  const topCategories = await queryMany<{ id: string; name: string }>(
    `SELECT id, name FROM categories WHERE parent_category_id IS NULL AND is_active = true ORDER BY display_order ASC, name ASC`
  ).catch(() => [] as { id: string; name: string }[])

  return {
    categories,
    brands,
    topCategories: topCategories.map(c => ({ value: c.id, label: c.name })),
    counts: {
      featured: Number(counts?.featured ?? 0),
      newArrivals: Number(counts?.new_arrivals ?? 0),
      bestSellers: Number(counts?.best_sellers ?? 0),
      onSale: Number(counts?.on_sale ?? 0),
      bundles: Number(counts?.bundles ?? 0),
      approvedReviews: Number(counts?.approved_reviews ?? 0),
    },
    copyDefaults: {
      about: { subtitle: defaultAboutCopy(storefront.aboutCopy, identity.name) },
    },
    tileDefaults: {
      about: resolveAboutStats(storefront.statsJson),
    },
  }
}

export default async function HomepagePage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string; page?: string; audience?: string }>
}) {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()
  const params = await searchParams
  const surface = rowSurface({ surface: params.surface })

  const admin = await queryOne<{ role: string; scopes: string[] }>(`SELECT role, scopes FROM admins WHERE id = $1`, [
    adminId,
  ])
  if (!admin || !hasScope(admin.role, admin.scopes || [], 'settings:write')) {
    redirect(ap('/admin/settings', host))
  }

  const [hero, editable, draftSummary, initialLock, plan] = await Promise.all([
    loadHeroData(),
    getEditableHomepage(),
    getHomepageDraftSummary(),
    initialDraftLock('homepage', HOMEPAGE_LOCK_ID),
    getHomepagePlan(),
  ])
  // The business homepage has no listing pages, and falls back to the store's without the plan.
  const audience: HomepageAudience = params.audience === 'business' && plan.business ? 'business' : 'store'
  const business = audience === 'business'
  const page = business ? 'home' : rowPage({ page: params.page })
  const sectionOptions = await loadSectionOptions(hero.categoryOptions, hero.brandOptions)
  const draftPending = draftSummary.hasDraft && (changed(draftSummary.sections) || changed(draftSummary.slides))
  const onPage = editable.sections.filter(s => rowAudience(s) === audience && rowPage(s) === page)
  const sections = onPage.filter(s => rowSurface(s) === surface)
  const desktopCount = onPage.filter(s => rowSurface(s) === 'web').length
  const heroSlides = editable.heroSlides.filter(s => rowSurface(s) === surface && rowAudience(s) === audience)
  // "Start from the store homepage" copies what the store shows here: this layout, or the desktop one it mirrors.
  const storeSource: HomepageSurface = editable.sections.some(
    s => rowAudience(s) === 'store' && rowPage(s) === 'home' && rowSurface(s) === surface
  )
    ? surface
    : 'web'
  const upgrade: Partial<Record<SectionType, string>> = {}
  for (const [type, slug] of Object.entries(plan.upgrade)) {
    const name = planName(slug)
    if (name) upgrade[type as SectionType] = name
  }
  const businessNeeds = planName(plan.businessUpgrade)
  const base = ap('/admin/settings/homepage', host)
  const hrefFor = (p: HomepagePage, s: HomepageSurface, a: HomepageAudience = audience) => {
    const q = new URLSearchParams()
    if (a === 'business') q.set('audience', a)
    else if (p !== 'home') q.set('page', p)
    if (s !== 'web') q.set('surface', s)
    return q.size ? `${base}?${q}` : base
  }
  // Pending-change counts per tab come from the server render; the footer keeps the live total.
  const pendingOf = (d: { sections: DraftDiff; slides: DraftDiff }) =>
    draftSummary.hasDraft
      ? d.sections.added + d.sections.removed + d.sections.edited + d.slides.added + d.slides.removed + d.slides.edited
      : 0
  const pendingOnPage = (p: HomepagePage) =>
    HOMEPAGE_SURFACES.reduce((n, s) => n + pendingOf(draftSummary.byPage[p][s]), 0)
  const pendingOnLayout = (s: HomepageSurface) =>
    pendingOf(business ? draftSummary.business[s] : draftSummary.byPage[page][s])
  const pendingFor: Record<HomepageAudience, number> = {
    store: HOMEPAGE_PAGES.reduce((n, p) => n + pendingOnPage(p), 0),
    business: HOMEPAGE_SURFACES.reduce((n, s) => n + pendingOf(draftSummary.business[s]), 0),
  }

  // Mirror the other migrated entities: header carries only title + description + badges;
  // one shared FormFooter at the bottom owns Cancel / Save as Draft / Publish / Discard.
  return (
    <HomepageLockProvider lockId={HOMEPAGE_LOCK_ID} initial={initialLock}>
      <div className="p-4 sm:p-6 pb-28 lg:pb-6 space-y-5">
        <PageHeader
          title="Homepage"
          description={business ? BUSINESS_DESCRIPTION : PAGE_COPY[page].description}
          badges={draftPending ? <Badge tone="amber">Draft pending</Badge> : null}
        />

        <div
          role="tablist"
          aria-label="Homepage"
          className="flex h-control gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg w-fit"
        >
          {HOMEPAGE_AUDIENCES.map(a =>
            a === 'business' && !plan.business ? (
              <span
                key={a}
                role="tab"
                aria-selected={false}
                aria-disabled="true"
                title={businessNeeds ? `The business homepage comes with ${businessNeeds}` : 'Not in your plan'}
                className="flex items-center gap-1.5 px-3 text-xs font-medium rounded-md text-foreground-muted opacity-70 cursor-not-allowed"
              >
                <Lock className="w-3 h-3" aria-hidden="true" />
                {AUDIENCE_TAB[a]}
                {businessNeeds && <span className="font-normal">· Comes with {businessNeeds}</span>}
              </span>
            ) : (
              <Link
                key={a}
                href={hrefFor('home', surface, a)}
                scroll={false}
                role="tab"
                aria-selected={a === audience}
                className={`flex items-center gap-1.5 px-3 text-xs font-medium rounded-md ${a === audience ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
              >
                {AUDIENCE_TAB[a]}
                {pendingFor[a] > 0 && <span className="tabular-nums opacity-80">{pendingFor[a]}</span>}
              </Link>
            )
          )}
        </div>

        {!business && (
          <TabLinks
            value={page}
            scroll={false}
            tabs={HOMEPAGE_PAGES.map(p => ({
              id: p,
              label: PAGE_COPY[p].tab,
              href: hrefFor(p, surface),
              count: pendingOnPage(p),
            }))}
          />
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div
            role="tablist"
            aria-label="Layout"
            className="flex h-control gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg w-fit"
          >
            {HOMEPAGE_SURFACES.map(s => {
              const pending = pendingOnLayout(s)
              return (
                <Link
                  key={s}
                  href={hrefFor(page, s)}
                  scroll={false}
                  role="tab"
                  aria-selected={s === surface}
                  className={`flex items-center gap-1.5 px-3 text-xs font-medium rounded-md ${s === surface ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`}
                >
                  {SURFACE_TAB[s]}
                  {pending > 0 && <span className="tabular-nums opacity-80">{pending}</span>}
                </Link>
              )
            })}
          </div>
          <p className="text-xs text-foreground-muted">{SURFACE_NOTE[surface]}</p>
        </div>

        <HomepageLockBanner />

        {/* Keyed by homepage, page and surface: both managers seed their state from props once. */}
        <HomepageSectionManager
          key={`${audience}:${page}:${surface}`}
          audience={audience}
          surface={surface}
          page={page}
          desktopCount={desktopCount}
          storeSource={storeSource}
          initial={sections}
          options={sectionOptions}
          planTypes={plan.types}
          upgrade={upgrade}
          heroEditor={
            <HeroSlideManager
              key={`hero-editor-${audience}-${surface}`}
              audience={audience}
              surface={surface}
              initialSlides={heroSlides}
              categoryOptions={hero.categoryOptions}
              brandOptions={hero.brandOptions}
              gradeOptions={hero.gradeOptions}
              materialOptions={hero.materialOptions}
            />
          }
        />

        <HomepageFormFooter
          initialSummary={draftSummary}
          resnapshotAction={resnapshotHomepageSession}
          cancelHref={ap('/admin/settings', host)}
        />
      </div>
    </HomepageLockProvider>
  )
}
