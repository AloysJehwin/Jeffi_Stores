import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/shared/db'
import { hasScope } from '@/lib/auth/scopes'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import HeroSlideManager from '@/components/admin/HeroSlideManager'
import HomepageSectionManager from '@/components/admin/homepage/HomepageSectionManager'
import HomepageFormFooter from '@/components/admin/homepage/HomepageFormFooter'
import { getStorefrontContent, getStoreIdentity } from '@/lib/catalog/site-controls'
import { defaultAboutCopy, resolveAboutStats, rowSurface, type HomepageSurface } from '@/lib/catalog/homepage-sections'
import { getEditableHomepage, getHomepageDraftSummary, type DraftDiff } from '@/lib/catalog/homepage-draft'
import type { SectionOptions } from '@/components/admin/homepage/editors/fields'
import { Badge, PageHeader, TabLinks } from '@/components/admin/kit'
import { resnapshotHomepageSession } from './actions'

const SURFACE_COPY: Record<HomepageSurface, { tab: string; description: string }> = {
  web: {
    tab: 'Website',
    description:
      'Everything on the website homepage, in the order it appears. Drag to reorder, toggle to hide, and expand a section to edit it. Hero slides are edited inside the Hero section; offer slides inside the Offer Slider section. Changes are saved as a draft and go live only when you publish.',
  },
  app: {
    tab: 'Mobile app',
    description:
      'The mobile app\'s own homepage. Until it has sections of its own the app shows the website layout. Start from a copy of the website layout or add sections here; one publish covers both the website and the app.',
  },
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

export default async function HomepagePage({ searchParams }: { searchParams: Promise<{ surface?: string }> }) {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()
  const surface: HomepageSurface = (await searchParams).surface === 'app' ? 'app' : 'web'

  const admin = await queryOne<{ role: string; scopes: string[] }>(`SELECT role, scopes FROM admins WHERE id = $1`, [
    adminId,
  ])
  if (!admin || !hasScope(admin.role, admin.scopes || [], 'settings:write')) {
    redirect(ap('/admin/settings', host))
  }

  const [hero, editable, draftSummary] = await Promise.all([
    loadHeroData(),
    getEditableHomepage(),
    getHomepageDraftSummary(),
  ])
  const sectionOptions = await loadSectionOptions(hero.categoryOptions, hero.brandOptions)
  const draftPending = draftSummary.hasDraft && (changed(draftSummary.sections) || changed(draftSummary.slides))
  const sections = editable.sections.filter(s => rowSurface(s) === surface)
  const heroSlides = editable.heroSlides.filter(s => rowSurface(s) === surface)
  const base = ap('/admin/settings/homepage', host)
  // Pending-change counts per tab come from the server render; the footer keeps the live total.
  const pendingOn = (s: HomepageSurface) => {
    const d = draftSummary.bySurface[s]
    return draftSummary.hasDraft ? d.sections.added + d.sections.removed + d.sections.edited + d.slides.added + d.slides.removed + d.slides.edited : 0
  }

  // Mirror the other migrated entities: header carries only title + description + badges;
  // one shared FormFooter at the bottom owns Cancel / Save as Draft / Publish / Discard.
  return (
    <div className="p-4 sm:p-6 pb-28 lg:pb-6 space-y-5">
      <PageHeader
        title="Homepage"
        description={SURFACE_COPY[surface].description}
        badges={draftPending ? <Badge tone="amber">Draft pending</Badge> : null}
      />

      <TabLinks
        value={surface}
        scroll={false}
        tabs={[
          { id: 'web', label: SURFACE_COPY.web.tab, href: base, count: pendingOn('web') },
          { id: 'app', label: SURFACE_COPY.app.tab, href: `${base}?surface=app`, count: pendingOn('app') },
        ]}
      />

      {/* Keyed by surface: both managers seed their state from props once. */}
      <HomepageSectionManager
        key={surface}
        surface={surface}
        initial={sections}
        options={sectionOptions}
        heroEditor={
          <HeroSlideManager
            key={`hero-editor-${surface}`}
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
        adminId={adminId}
        initialSummary={draftSummary}
        resnapshotAction={resnapshotHomepageSession}
        cancelHref={ap('/admin/settings', host)}
      />
    </div>
  )
}
