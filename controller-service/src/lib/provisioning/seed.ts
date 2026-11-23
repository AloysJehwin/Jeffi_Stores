import type { PoolClient } from 'pg'
import { catalogFor, SEED_PROFILES } from './seed-catalog'
import { DEFAULT_SECTIONS, HOMEPAGE_SURFACES } from '@/lib/catalog/homepage-sections'
import type { SampleCatalog } from '@/lib/site/data/types'
import { cleanStockCredit, isStockImageUrl, STOCK_CREDITS_SETTING, type StockCredit } from '@/lib/ai/stock-credits'
import { dbTarget, tenantAdminPool, type DbAuth } from './tenant-admin-pool'

/**
 * Starter-data seeding for a freshly-provisioned tenant DB.
 *
 * `load_schema` installs the schema with zero rows. This runs afterwards, only when the
 * job carries a `seedProfile` (the tenant's chosen onboarding category), and writes a
 * small placeholder catalogue so a brand-new store is not empty on first login. Every row
 * is ordinary editable data.
 *
 * Idempotent: re-running inserts nothing new, so a retried step is safe.
 */

const KNOWN_PROFILES = new Set<string>(SEED_PROFILES)

// 'Home Décor' → 'home-decor': the accent is dropped, not turned into a hyphen.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function skuFrom(name: string, i: number): string {
  const base = name
    .replace(/[^A-Za-z0-9]+/g, '')
    .slice(0, 6)
    .toUpperCase()
  return `${base || 'ITEM'}-${String(i + 1).padStart(3, '0')}`
}

export async function seedTenantData(endpoint: string, dbName: string, profile: string, db?: DbAuth): Promise<void> {
  if (!KNOWN_PROFILES.has(profile)) {
    throw new Error(`seed_data: unknown seedProfile '${profile}' (known: ${SEED_PROFILES.join(', ')})`)
  }
  const cat = catalogFor(profile)
  const pool = await tenantAdminPool(dbTarget(endpoint, dbName, db))
  const client = await pool.connect().catch(async e => {
    await pool.end().catch(() => {})
    throw e
  })
  try {
    await client.query('BEGIN')

    const catRes = await client.query(
      `INSERT INTO categories (name, slug, description, display_order, is_active)
       VALUES ($1, $2, $3, 0, true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [cat.category, cat.categorySlug, `Starter category for ${cat.category}. Edit or remove it at any time.`]
    )
    const categoryId = catRes.rows[0]?.id ?? null

    for (const [i, item] of cat.items.entries()) {
      await client.query(
        `INSERT INTO products (category_id, sku, name, slug, description, short_description,
                               base_price, currency, is_featured, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'INR',$8,true)
         ON CONFLICT DO NOTHING`,
        [
          categoryId,
          skuFrom(item.name, i),
          item.name,
          slugify(item.name),
          item.blurb,
          item.blurb.slice(0, 200),
          item.price,
          i < 3,
        ]
      )
    }

    await seedHomepage(client, cat.hero, cat.categorySlug, cat.category)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

/** The classic homepage (hero slides and sections) for every surface; a store whose site is not installed shows it. */
async function seedHomepage(client: PoolClient, hero: ReturnType<typeof catalogFor>['hero'], categorySlug: string, categoryName: string): Promise<void> {
  // Every surface (desktop web, phone web, app) gets a layout of its own, so editing one never changes another.
  for (const surface of HOMEPAGE_SURFACES) {
    for (const [i, h] of hero.entries()) {
      const exists = await client.query('SELECT 1 FROM hero_slides WHERE title = $1 AND surface = $2 LIMIT 1', [h.title, surface])
      if (exists.rowCount) continue
      await client.query(
        `INSERT INTO hero_slides (title, subtitle, badge_text, cta_label, cta_url, filter_category, display_order, is_active, surface)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
        [h.title, h.subtitle, h.badge, h.cta, `/products?category=${categorySlug}`, categoryName, i, surface]
      )
    }

    const hasSections = await client.query('SELECT 1 FROM homepage_sections WHERE surface = $1 LIMIT 1', [surface])
    if (!hasSections.rowCount) {
      for (const [i, s] of DEFAULT_SECTIONS.entries()) {
        await client.query(
          `INSERT INTO homepage_sections (type, title, subtitle, eyebrow, config, display_order, is_active, surface)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
          [s.type, s.title, s.subtitle, s.eyebrow, JSON.stringify(s.config), i, surface]
        )
      }
    }
  }
}

const cut = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 500

/** A sample product's attributes as name → value, whichever shape the catalogue used. */
function attrsOf(a: SampleCatalog['products'][number]['attributes']): Map<string, string> {
  const list = Array.isArray(a) ? a.map(x => [x?.name, x?.value] as const) : Object.entries(a ?? {})
  return new Map(list.filter(([k]) => typeof k === 'string' && k).map(([k, v]) => [String(k).toLowerCase(), String(v ?? '')]))
}

/**
 * The owner's AI Site Studio sample catalogue, so the live store shows the products its pages were designed with:
 * categories (same slugs, so the pages' links resolve), brands, and products with prices, MRP and pictures. The
 * pictures stay on the platform CDN, which every store's image settings allow. Made-up reviews and offers stay out:
 * real shoppers would take them as genuine. Then the category's classic homepage, as the generic seed does.
 * Idempotent like seedTenantData.
 */
export async function seedStudioCatalog(
  endpoint: string,
  dbName: string,
  catalog: SampleCatalog,
  profile: string,
  db?: DbAuth
): Promise<{ categories: number; brands: number; products: number; images: number }> {
  const counts = { categories: 0, brands: 0, products: 0, images: 0 }
  const pool = await tenantAdminPool(dbTarget(endpoint, dbName, db))
  const client = await pool.connect().catch(async e => {
    await pool.end().catch(() => {})
    throw e
  })
  try {
    await client.query('BEGIN')

    // A category without its own picture shows its first product's, as the studio preview did.
    const firstPicture = new Map<string, string>()
    for (const p of catalog.products ?? []) {
      const url = (p.images ?? []).find(isUrl)
      if (url && !firstPicture.has(p.category)) firstPicture.set(p.category, url)
    }
    const catIds = new Map<string, string>()
    const seenCat = new Set<string>()
    for (const [i, c] of (catalog.categories ?? []).entries()) {
      const name = cut(c.name, 100)
      const slug = slugify(c.slug || c.name || '').slice(0, 100)
      if (!name || !slug || seenCat.has(slug) || seenCat.has(name.toLowerCase())) continue
      seenCat.add(slug).add(name.toLowerCase())
      const r = await client.query<{ id: string }>(
        `INSERT INTO categories (name, slug, description, image_url, tagline, display_order, is_active, is_featured)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, slug, cut(c.description, 2000), isUrl(c.image) ? c.image : (firstPicture.get(c.slug) ?? null), cut(c.tagline, 160), i, i < 4]
      )
      catIds.set(c.slug, r.rows[0].id)
      counts.categories++
    }
    for (const c of catalog.categories ?? []) {
      const id = catIds.get(c.slug)
      const parent = c.parent ? catIds.get(c.parent) : undefined
      if (id && parent && parent !== id) await client.query('UPDATE categories SET parent_category_id = $1 WHERE id = $2', [parent, id])
    }

    const brandIds = new Map<string, string>()
    const seenBrand = new Set<string>()
    for (const [i, b] of (catalog.brands ?? []).entries()) {
      const name = cut(b.name, 100)
      const slug = slugify(b.slug || b.name || '').slice(0, 100)
      if (!name || !slug || seenBrand.has(slug) || seenBrand.has(name.toLowerCase())) continue
      seenBrand.add(slug).add(name.toLowerCase())
      const r = await client.query<{ id: string }>(
        `INSERT INTO brands (name, slug, logo_url, description, tagline, story, website, is_featured, display_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, slug, isUrl(b.logo) ? b.logo : null, cut(b.description, 2000), cut(b.tagline, 160), cut(b.story, 4000), cut(b.website, 255), !!b.featured, i]
      )
      brandIds.set(b.slug, r.rows[0].id)
      counts.brands++
    }

    for (const [i, p] of (catalog.products ?? []).entries()) {
      const name = cut(p.name, 255)
      const slug = slugify(p.slug || p.name || '').slice(0, 255)
      const price = Number(p.price)
      if (!name || !slug || !(price > 0)) continue
      const mrp = Number(p.mrp) > price ? Number(p.mrp) : null
      const a = attrsOf(p.attributes)
      const description = cut(p.description, 4000)
      const r = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, brand_id, sku, name, slug, description, short_description, base_price, mrp, currency,
                               is_featured, is_active, material, finish, size, stock_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'INR',$10,true,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          catIds.get(p.category) ?? null,
          p.brand ? (brandIds.get(p.brand) ?? null) : null,
          skuFrom(name, i),
          name,
          slug,
          description,
          description?.slice(0, 500) ?? null,
          price,
          mrp,
          p.featured ?? i < 4,
          cut(a.get('material'), 100),
          cut(a.get('finish'), 100),
          cut(a.get('size'), 100),
          p.inStock === false ? 'Out of Stock' : 'In Stock',
        ]
      )
      const id = r.rows[0]?.id
      if (!id) continue // already seeded by an earlier run
      counts.products++
      for (const [j, url] of (p.images ?? []).filter(isUrl).slice(0, 6).entries()) {
        await client.query(
          // The picture is its own thumbnail: lists that draw thumbnails (search, orders) would otherwise show none.
          `INSERT INTO product_images (product_id, image_url, thumbnail_url, file_name, alt_text, display_order, is_primary) VALUES ($1,$2,$2,$3,$4,$5,$6)`,
          [id, url, (url.split('/').pop() || 'image').slice(0, 255), name, j, j === 0]
        )
        counts.images++
      }
    }

    // Stock photos keep their credits (the store's footer draws them while a product or category uses the photo).
    const credits: Record<string, StockCredit> = {}
    for (const p of catalog.products ?? []) {
      const url = (p.images ?? []).find(isUrl)
      const credit = url && isStockImageUrl(url) ? cleanStockCredit(p.imageCredit) : null
      if (url && credit) credits[url] = credit
    }
    if (Object.keys(credits).length) {
      await client.query(
        `INSERT INTO site_settings (key, value, data_type, description, updated_at) VALUES ($1, $2, 'json', 'Credits for stock photos by image URL (lib/site/photo-credits.ts)', now())
         ON CONFLICT (key) DO UPDATE SET value = (CASE WHEN site_settings.value ~ '^\\s*\\{' THEN site_settings.value::jsonb ELSE '{}'::jsonb END || EXCLUDED.value::jsonb)::text, updated_at = now()`,
        [STOCK_CREDITS_SETTING, JSON.stringify(credits)]
      )
    }

    const first = (catalog.categories ?? []).find(c => catIds.has(c.slug))
    if (KNOWN_PROFILES.has(profile)) {
      const cat = catalogFor(profile)
      await seedHomepage(client, cat.hero, first ? slugify(first.slug || first.name) : cat.categorySlug, first?.name ?? cat.category)
    }

    await client.query('COMMIT')
    return counts
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}
