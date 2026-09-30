import { Pool } from 'pg'
import { createPgPool, rdsSslOption } from '../pg-pool'
import { catalogFor, SEED_PROFILES } from './seed-catalog'
import { DEFAULT_SECTIONS } from '@/lib/homepage-sections'

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

function slugify(s: string): string {
  return s
    .toLowerCase()
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

function tenantMasterPool(endpoint: string, dbName: string): Pool {
  const masterPassword = process.env.RDS_MASTER_PASSWORD
  if (!masterPassword) throw new Error('RDS_MASTER_PASSWORD is not set — required to seed a tenant DB')
  const user = process.env.TENANT_RDS_MASTER_USER || process.env.RDS_MASTER_USER || 'postgres'
  return createPgPool({
    host: endpoint,
    port: 5432,
    database: dbName,
    user,
    password: masterPassword,
    ssl: rdsSslOption(),
    max: 2,
    connectionTimeoutMillis: 20000,
  })
}

export async function seedTenantData(endpoint: string, dbName: string, profile: string): Promise<void> {
  if (!KNOWN_PROFILES.has(profile)) {
    throw new Error(`seed_data: unknown seedProfile '${profile}' (known: ${SEED_PROFILES.join(', ')})`)
  }
  const cat = catalogFor(profile)
  const pool = tenantMasterPool(endpoint, dbName)
  const client = await pool.connect()
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

    for (const [i, h] of cat.hero.entries()) {
      const exists = await client.query('SELECT 1 FROM hero_slides WHERE title = $1 LIMIT 1', [h.title])
      if (exists.rowCount) continue
      await client.query(
        `INSERT INTO hero_slides (title, subtitle, badge_text, cta_label, cta_url, filter_category, display_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [h.title, h.subtitle, h.badge, h.cta, `/products?category=${cat.categorySlug}`, cat.category, i]
      )
    }

    const hasSections = await client.query('SELECT 1 FROM homepage_sections LIMIT 1')
    if (!hasSections.rowCount) {
      for (const [i, s] of DEFAULT_SECTIONS.entries()) {
        await client.query(
          `INSERT INTO homepage_sections (type, title, subtitle, eyebrow, config, display_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,true)`,
          [s.type, s.title, s.subtitle, s.eyebrow, JSON.stringify(s.config), i]
        )
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}
