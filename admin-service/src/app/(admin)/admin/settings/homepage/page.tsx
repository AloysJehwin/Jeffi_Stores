import Link from 'next/link'
import { Lock } from 'lucide-react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import HeroSlidesBySurface from '@/components/admin/homepage/HeroSlidesBySurface'
import HomepageSectionManager from '@/components/admin/homepage/HomepageSectionManager'
import HomepagePreviewButton from '@/components/admin/homepage/HomepagePreview'
import HomepageFormFooter from '@/components/admin/homepage/HomepageFormFooter'
import { HomepageLockBanner, HomepageLockProvider } from '@/components/admin/homepage/HomepageLock'
import EntityDrafts from '@/components/admin/drafts/EntityDrafts'
import DraftBehindBanner from '@/components/admin/drafts/DraftBehindBanner'
import MergeOnLoad from '@/components/admin/drafts/MergeOnLoad'
import PageDrafts, { DraftsTabLabel } from '@/components/admin/drafts/PageDrafts'
import { HOMEPAGE_ENTITY_ID, initialDraftLock } from '@/lib/admin/draft-locks'
import { draftBehind, draftsForView } from '@/lib/admin/draft-branches'
import { getStorefrontContent, getStoreIdentity } from '@/lib/catalog/site-controls'
import {
  HOMEPAGE_AUDIENCES,
  HOMEPAGE_PAGES,
  HOMEPAGE_SURFACES,
  defaultAboutCopy,
  resolveAboutStats,
  rowAudience,
  rowPage,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSurface,
  type SectionType,
} from '@/lib/catalog/homepage-sections'
import { getHomepagePlan, planName } from '@/lib/catalog/homepage-plan'
import { signHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { getEditableHomepage, getHomepageDraftSummary, homepageDrafts, type DraftDiff } from '@/lib/catalog/homepage-draft'
import type { SectionOptions } from '@/components/admin/homepage/editors/fields'
import { Badge, PageHeader, TabStrip } from '@/components/admin/kit'
import { resnapshotHomepageSession, startHomepageDraft } from './actions'

const PAGE_COPY: Record<HomepagePage, { tab: string; description: string }> = {
  home: {
    tab: 'Home',
    description:
      'Everything on the homepage, row by row: a row is one full-width section or two side by side. Drag to reorder or pair sections, pick which devices each one shows on, and expand a section to edit it. Hero slides are edited inside the Hero section; offer slides inside the Offer Slider section. Changes are saved as a draft and go live only when you publish.',
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
  'The homepage business accounts see at /business and on the business store in the app. Drag to reorder or pair sections, pick which devices each one shows on, and expand a section to edit it. Until it has sections of its own it shows the store homepage. Changes are saved as a draft and go live only when you publish.'

const AUDIENCE_TAB: Record<HomepageAudience, string> = { store: 'Store', business: 'Business' }
// The kit's tabCls is client-only; same classes, usable from this server page.
const tabCls = (active: boolean) =>
  `inline-flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 shrink-0 transition-colors ${
    active ? 'border-accent-500 text-foreground font-medium' : 'border-transparent text-foreground-muted hover:text-foreground'
  }`
const SURFACE_TAB: Record<HomepageSurface, string> = { web: 'Desktop web', web_mobile: 'Mobile web', app: 'App' }

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
  searchParams: Promise<{ page?: string; audience?: string; draft?: string; view?: string; merge?: string; surface?: string }>
}) {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()
  const params = await searchParams

  const admin = await queryOne<{ role: string; scopes: string[] }>(`SELECT role, scopes FROM admins WHERE id = $1`, [
    adminId,
  ])
  if (!admin || !hasScope(admin.role, admin.scopes || [], 'settings:write')) {
    redirect(ap('/admin/settings', host))
  }

  // ?draft=<id> edits that draft; without one the live homepage shows read-only.
  const askedDraft = params.draft && /^[0-9a-f-]{36}$/i.test(params.draft) ? params.draft : null
  const [hero, editable, draftSummary, plan, drafts] = await Promise.all([
    loadHeroData(),
    getEditableHomepage(askedDraft),
    getHomepageDraftSummary(askedDraft),
    getHomepagePlan(),
    draftsForView(homepageDrafts, HOMEPAGE_ENTITY_ID, adminId),
  ])
  const draftId = editable.draft?.id ?? null
  const draftGone = !!askedDraft && !draftId
  const [initialLock, behind] = draftId
    ? await Promise.all([initialDraftLock('homepage', draftId), draftBehind(homepageDrafts, draftId)])
    : [null, null]
  const showDrafts = params.view === 'drafts'
  const myDraft = drafts.find(d => d.authorId === adminId)
  // The business homepage has no listing pages, and falls back to the store's without the plan.
  const audience: HomepageAudience = params.audience === 'business' && plan.business ? 'business' : 'store'
  const business = audience === 'business'
  const page = business ? 'home' : rowPage({ page: params.page })
  // The device the selector highlights: each card's switch shows / hides the section there.
  const surface: HomepageSurface = HOMEPAGE_SURFACES.includes(params.surface as HomepageSurface) ? (params.surface as HomepageSurface) : 'web'
  const sectionOptions = await loadSectionOptions(hero.categoryOptions, hero.brandOptions)
  const draftPending = draftSummary.hasDraft && (changed(draftSummary.sections) || changed(draftSummary.slides))
  // One layout per page: every surface's sections, each with its own show/hide toggles.
  const sections = editable.sections.filter(s => rowAudience(s) === audience && rowPage(s) === page)
  const heroSlides = editable.heroSlides.filter(s => rowAudience(s) === audience)
  // The preview iframe opens the store on its own host with a signed token naming the draft.
  const previewToken = draftId ? await signHomepagePreviewToken({ draftId, audience }) : null
  const upgrade: Partial<Record<SectionType, string>> = {}
  for (const [type, slug] of Object.entries(plan.upgrade)) {
    const name = planName(slug)
    if (name) upgrade[type as SectionType] = name
  }
  const businessNeeds = planName(plan.businessUpgrade)
  const base = ap('/admin/settings/homepage', host)
  const hrefFor = (p: HomepagePage, a: HomepageAudience = audience, s: HomepageSurface = surface) => {
    const q = new URLSearchParams()
    if (a === 'business') q.set('audience', a)
    else if (p !== 'home') q.set('page', p)
    if (s !== 'web') q.set('surface', s)
    if (draftId) q.set('draft', draftId)
    return q.size ? `${base}?${q}` : base
  }
  const tabFields = (
    <>
      {business && <input type="hidden" name="audience" value="business" />}
      {!business && page !== 'home' && <input type="hidden" name="page" value={page} />}
    </>
  )
  // Pending-change counts per tab come from the server render; the footer keeps the live total.
  const pendingOf = (d: { sections: DraftDiff; slides: DraftDiff }) =>
    draftSummary.hasDraft
      ? d.sections.added + d.sections.removed + d.sections.edited + d.slides.added + d.slides.removed + d.slides.edited
      : 0
  const pendingOnPage = (p: HomepagePage) =>
    HOMEPAGE_SURFACES.reduce((n, s) => n + pendingOf(draftSummary.byPage[p][s]), 0)
  const pendingFor: Record<HomepageAudience, number> = {
    store: HOMEPAGE_PAGES.reduce((n, p) => n + pendingOnPage(p), 0),
    business: HOMEPAGE_SURFACES.reduce((n, s) => n + pendingOf(draftSummary.business[s]), 0),
  }

  const pill = (on: boolean) =>
    `flex items-center gap-1.5 px-3 text-xs font-medium rounded-md ${on ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`
  const deviceTabs = (
    <div role="tablist" aria-label="Device" className="flex h-control gap-0.5 p-0.5 bg-surface-elevated border border-border-default rounded-lg w-fit">
      {HOMEPAGE_SURFACES.map(s => (
        <Link key={s} href={hrefFor(page, audience, s)} scroll={false} role="tab" aria-selected={s === surface} className={pill(s === surface)}>
          {SURFACE_TAB[s]}
        </Link>
      ))}
    </div>
  )
  const audienceTabs = (
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
          href={hrefFor('home', a)}
          scroll={false}
          role="tab"
          aria-selected={a === audience}
          className={pill(a === audience)}
        >
          {AUDIENCE_TAB[a]}
          {pendingFor[a] > 0 && <span className="tabular-nums opacity-80">{pendingFor[a]}</span>}
        </Link>
      )
    )}
    </div>
  )

  // Mirror the other migrated entities: header carries only title + description + badges;
  // one shared FormFooter at the bottom owns Cancel / Save as Draft / Publish / Discard.
  return (
    <HomepageLockProvider draftId={draftId} initial={initialLock}>
      <div className="p-4 sm:p-6 pb-28 lg:pb-6 space-y-5">
        <PageHeader
          title={draftId ? `Homepage · ${editable.draft?.title || 'Draft'}` : 'Homepage'}
          description={business ? BUSINESS_DESCRIPTION : PAGE_COPY[page].description}
          badges={
            draftId ? (
              draftPending ? <Badge tone="amber">Draft pending</Badge> : <Badge tone="muted">Draft · no changes yet</Badge>
            ) : drafts.length ? (
              <Badge tone="amber">{drafts.length === 1 ? '1 open draft' : `${drafts.length} open drafts`}</Badge>
            ) : null
          }
        />

        {/* One tab line: Editor / Drafts, then the page tabs; Store / Business and Preview on the right. */}
        <TabStrip
          selected={showDrafts ? 'drafts' : page}
          actions={
            <>
              {!showDrafts && deviceTabs}
              {audienceTabs}
              {previewToken && !showDrafts && page === 'home' && <HomepagePreviewButton token={previewToken} audience={audience} surface={surface} />}
            </>
          }
        >
          <Link href={draftId ? `${base}?draft=${draftId}` : base} scroll={false} role="tab" aria-selected={!showDrafts} className={tabCls(!showDrafts)}>
            {draftId ? 'Editor' : 'Live homepage'}
          </Link>
          <Link href={`${base}?view=drafts`} scroll={false} role="tab" aria-selected={showDrafts} className={tabCls(showDrafts)}>
            <DraftsTabLabel type="homepage" />
          </Link>
          <span aria-hidden="true" className="self-center mx-1.5 h-5 w-px bg-border-default shrink-0" />
          {(business ? (['home'] as HomepagePage[]) : HOMEPAGE_PAGES).map(p => {
            const on = !showDrafts && p === page
            const count = business ? 0 : pendingOnPage(p)
            return (
              <Link key={p} href={hrefFor(p)} scroll={false} role="tab" aria-selected={on} className={tabCls(on)}>
                {PAGE_COPY[p].tab}
                {count ? <span className="text-xs text-accent-500">({count})</span> : null}
              </Link>
            )
          })}
        </TabStrip>

        {showDrafts ? (
          <PageDrafts type="homepage">
            <EntityDrafts drafts={drafts} start={startHomepageDraft} back={base} me={adminId} noun="homepage" />
          </PageDrafts>
        ) : (
          <>
        {draftGone && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-foreground">
            That draft was published or discarded. You are looking at the live homepage.
          </p>
        )}
        {!draftId && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-surface-elevated px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">You are looking at the live homepage</p>
              <p className="text-xs text-foreground-muted">
                Edits go into a draft and reach the store only when you publish. Several admins can each work on their own draft.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form action={startHomepageDraft} className="flex items-center gap-2">
                {tabFields}
                <input type="hidden" name="_new" value="1" />
                <input name="_title" maxLength={120} placeholder="Draft name (optional)" className="control-sm w-44 rounded-md border border-border-secondary bg-surface px-2 text-xs" />
                <button type="submit" className="control-sm inline-flex items-center border border-border-secondary bg-surface text-xs text-foreground-secondary hover:bg-surface-secondary">
                  New draft
                </button>
              </form>
              {myDraft && (
                <form action={startHomepageDraft}>
                  {tabFields}
                  <input type="hidden" name="_draft" value={myDraft.id} />
                  <button type="submit" className="control-sm inline-flex items-center bg-accent-500 text-xs font-semibold text-white hover:bg-accent-600">
                    Continue my draft
                  </button>
                </form>
              )}
            </div>
          </section>
        )}
        {!draftId && drafts.length > 0 && (
          <EntityDrafts drafts={drafts} start={startHomepageDraft} back={base} me={adminId} noun="homepage" />
        )}
        {draftId && params.merge === '1' && (
          <MergeOnLoad
            publishPath={`/api/admin/homepage-draft/publish?draft=${draftId}`}
            doneHref={base}
            closeHref={hrefFor(page)}
          />
        )}
        {draftId && <DraftBehindBanner info={behind} siblings={drafts.length - 1} noun="homepage" />}

        <HomepageLockBanner />


        {/* Keyed by homepage and page: both managers seed their state from props once. */}
        <HomepageSectionManager
          key={`${audience}:${page}`}
          audience={audience}
          page={page}
          surface={surface}
          initial={sections}
          options={sectionOptions}
          planTypes={plan.types}
          upgrade={upgrade}
          heroEditor={
            <HeroSlidesBySurface
              key={`hero-editor-${audience}`}
              audience={audience}
              initialSlides={heroSlides}
              categoryOptions={hero.categoryOptions}
              brandOptions={hero.brandOptions}
              gradeOptions={hero.gradeOptions}
              materialOptions={hero.materialOptions}
            />
          }
        />

        {draftId && (
          <HomepageFormFooter
            draftId={draftId}
            initialSummary={draftSummary}
            resnapshotAction={resnapshotHomepageSession}
            cancelHref={base}
            liveHref={base}
          />
        )}
          </>
        )}
      </div>
    </HomepageLockProvider>
  )
}
