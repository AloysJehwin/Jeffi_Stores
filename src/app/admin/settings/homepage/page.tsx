import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { queryOne, queryMany } from '@/lib/db'
import { hasScope } from '@/lib/scopes'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import HeroSlideManager from '@/components/admin/HeroSlideManager'
import HomepageSectionManager from '@/components/admin/homepage/HomepageSectionManager'
import HomepageDraftBar from '@/components/admin/homepage/HomepageDraftBar'
import { getStorefrontContent, getStoreIdentity } from '@/lib/site-controls'
import { defaultAboutCopy, resolveAboutStats } from '@/lib/homepage-sections'
import { getEditableHomepage, getHomepageDraftSummary } from '@/lib/homepage-draft'
import type { SectionOptions } from '@/components/admin/homepage/editors/fields'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function loadHeroData() {
  const [cats, brands, grades, materials] = await Promise.all([
    queryMany<{ slug: string; name: string }>(
      `SELECT slug, name FROM categories WHERE is_active = true AND slug IS NOT NULL ORDER BY name`
    ),
    queryMany<{ id: string; name: string }>(
      `SELECT id, name FROM brands WHERE is_active = true ORDER BY name`
    ),
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
  brands: { value: string; label: string }[],
): Promise<SectionOptions> {
  const [storefront, identity] = await Promise.all([getStorefrontContent(), getStoreIdentity()])
  const counts = await queryOne<{
    featured: string; new_arrivals: string; best_sellers: string; on_sale: string; bundles: string; approved_reviews: string
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

export default async function HomepagePage() {
  const headersList = await headers()
  const adminId = headersList.get('x-user-id') || ''
  const host = await getHost()

  const admin = await queryOne<{ role: string; scopes: string[] }>(
    `SELECT role, scopes FROM admins WHERE id = $1`, [adminId]
  )
  if (!admin || !hasScope(admin.role, admin.scopes || [], 'settings:write')) {
    redirect(ap('/admin/settings', host))
  }

  const [hero, editable, draftSummary] = await Promise.all([
    loadHeroData(), getEditableHomepage(), getHomepageDraftSummary(),
  ])
  const sectionOptions = await loadSectionOptions(hero.categoryOptions, hero.brandOptions)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Homepage</h1>
        <p className="text-sm text-foreground-muted mt-0.5">
          Everything on the homepage, in the order it appears. Drag to reorder, toggle to hide, and expand a section to edit it. Hero slides are edited inside the Hero section; offer slides inside the Offer Slider section. Changes are saved as a draft and go live only when you publish.
        </p>
      </div>

      <HomepageDraftBar initial={draftSummary} />

      <HomepageSectionManager
        initial={editable.sections}
        options={sectionOptions}
        heroEditor={
          <HeroSlideManager
            key="hero-editor"
            initialSlides={editable.heroSlides}
            categoryOptions={hero.categoryOptions}
            brandOptions={hero.brandOptions}
            gradeOptions={hero.gradeOptions}
            materialOptions={hero.materialOptions}
          />
        }
      />
    </div>
  )
}
