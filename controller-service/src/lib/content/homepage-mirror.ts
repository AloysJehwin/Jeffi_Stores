import 'server-only'
import type { PoolClient } from 'pg'
import { getClient, withTransaction } from '@/lib/shared/db'
import { publishHomepageDraft, withHomepageDraft, type DraftHeroSlide, type DraftSection } from '@/lib/catalog/homepage-draft'
import bundle from './flagship-homepage.json'

// Mirrors the flagship homepage exported from the local DB (deploy/k8s/db/content/export-homepage.sh) onto this
// store: offers and their products, the gallery rows the content shows, then sections and hero slides through the
// draft (one publish, as from the editor). Product and category IDs are kept when they exist here and remapped by
// slug when they don't; offers match by slug. Offers not in the bundle are switched off, never deleted.

type Row = Record<string, unknown>
interface Bundle {
  exportedAt: string
  sections: Row[]
  heroSlides: Row[]
  offers: (Row & { id: string; slug: string; items: string[] })[]
  gallery: (Row & { id: string; s3_key: string | null })[]
  refs: { products: Record<string, string>; categories: Record<string, string> }
}
const BUNDLE = bundle as unknown as Bundle

const OFFER_COLUMNS = [
  'slug', 'title', 'subtitle', 'badge_text', 'badge_color', 'image_url', 'image_url_mobile', 'blurhash',
  'blurhash_mobile', 'image_url_card', 'blurhash_card', 'video_url', 'video_url_card', 'cta_label', 'starts_at',
  'ends_at', 'display_order', 'is_active',
] as const
const GALLERY_COLUMNS = [
  'id', 'image_url', 'thumbnail_url', 's3_key', 's3_thumbnail_key', 's3_bucket', 'file_name', 'file_size', 'mime_type',
  'width', 'height', 'source_url', 'created_at', 'custom_name', 'blurhash', 'media_kind', 'source', 'prompt_text',
  'model_name',
] as const

export interface MirrorPlan {
  bundle: string
  sections: { surface: string; live: number; bundle: number }[]
  heroSlides: { live: number; bundle: number }
  offers: { insert: string[]; update: string[]; switchOff: string[] }
  offerProducts: number
  gallery: { insert: number; present: number }
  remapped: { products: number; categories: number }
  missing: { products: string[]; categories: string[] }
  openDraft: { updatedAt: string; by: string | null } | null
}

type Q = Pick<PoolClient, 'query'>

/** local id → id here (same id, or the row with the same slug); ids with neither are `missing`. */
async function mapRefs(q: Q, table: 'products' | 'categories', refs: Record<string, string>) {
  const ids = Object.keys(refs)
  const { rows } = await q.query<{ id: string; slug: string }>(
    `SELECT id::text, slug FROM ${table} WHERE id = ANY($1::uuid[]) OR slug = ANY($2::text[])`,
    [ids, Object.values(refs)]
  )
  const byId = new Set(rows.map(r => r.id))
  const bySlug = new Map(rows.map(r => [r.slug, r.id]))
  const map = new Map<string, string>()
  const missing: string[] = []
  for (const id of ids) {
    const live = byId.has(id) ? id : bySlug.get(refs[id])
    if (live) map.set(id, live)
    else missing.push(refs[id])
  }
  return { map, missing }
}

async function resolve(q: Q) {
  const products = await mapRefs(q, 'products', BUNDLE.refs.products)
  const categories = await mapRefs(q, 'categories', BUNDLE.refs.categories)
  const { rows: liveOffers } = await q.query<{ id: string; slug: string; is_active: boolean }>(
    `SELECT id::text, slug, is_active FROM product_offers`
  )
  const offerBySlug = new Map(liveOffers.map(o => [o.slug, o.id]))
  const offerIds = new Map(BUNDLE.offers.map(o => [o.id, offerBySlug.get(o.slug) ?? o.id]))
  const ids = new Map<string, string>([...products.map, ...categories.map, ...offerIds])
  for (const [k, v] of ids) if (k === v) ids.delete(k)
  return { products, categories, liveOffers, offerIds, ids }
}

// Swap each remapped UUID wherever it appears in the content.
function remap<T>(value: T, ids: Map<string, string>): T {
  if (!ids.size) return value
  const re = new RegExp([...ids.keys()].join('|'), 'g')
  return JSON.parse(JSON.stringify(value).replace(re, m => ids.get(m)!)) as T
}

export async function planHomepageMirror(): Promise<MirrorPlan> {
  const client = await getClient()
  try {
    await client.query('BEGIN READ ONLY')
    const r = await resolve(client)
    const { rows: counts } = await client.query<{ surface: string; n: number }>(
      `SELECT surface, count(*)::int AS n FROM homepage_sections GROUP BY surface`
    )
    const live = new Map(counts.map(c => [c.surface, c.n]))
    const surfaces = [...new Set([...live.keys(), ...BUNDLE.sections.map(s => String(s.surface))])].sort()
    const slides = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM hero_slides`)
    const gallery = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM gallery_images WHERE id = ANY($1::uuid[]) OR s3_key = ANY($2::text[])`,
      [BUNDLE.gallery.map(g => g.id), BUNDLE.gallery.map(g => g.s3_key).filter(Boolean)]
    )
    const draft = await client.query<{ updated_at: string; by: string | null }>(
      `SELECT d.updated_at::text, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS by
         FROM homepage_drafts d LEFT JOIN admins a ON a.id = d.updated_by LEFT JOIN users u ON u.id = a.user_id
        WHERE d.id = true`
    )
    const kept = new Set(r.offerIds.values())
    const plan: MirrorPlan = {
      bundle: BUNDLE.exportedAt,
      sections: surfaces.map(s => ({
        surface: s,
        live: live.get(s) ?? 0,
        bundle: BUNDLE.sections.filter(x => x.surface === s).length,
      })),
      heroSlides: { live: slides.rows[0].n, bundle: BUNDLE.heroSlides.length },
      offers: {
        insert: BUNDLE.offers.filter(o => !r.liveOffers.some(l => l.slug === o.slug)).map(o => o.slug),
        update: BUNDLE.offers.filter(o => r.liveOffers.some(l => l.slug === o.slug)).map(o => o.slug),
        switchOff: r.liveOffers.filter(l => l.is_active && !kept.has(l.id)).map(l => l.slug),
      },
      offerProducts: BUNDLE.offers.reduce((n, o) => n + o.items.filter(p => r.products.map.has(p)).length, 0),
      gallery: { insert: BUNDLE.gallery.length - gallery.rows[0].n, present: gallery.rows[0].n },
      remapped: {
        products: [...r.products.map].filter(([a, b]) => a !== b).length,
        categories: [...r.categories.map].filter(([a, b]) => a !== b).length,
      },
      missing: { products: r.products.missing, categories: r.categories.missing },
      openDraft: draft.rows[0] ? { updatedAt: draft.rows[0].updated_at, by: draft.rows[0].by } : null,
    }
    await client.query('COMMIT')
    return plan
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function applyHomepageMirror(): Promise<MirrorPlan> {
  const plan = await planHomepageMirror()
  const ids = await withTransaction(async client => {
    const r = await resolve(client)
    const offers = BUNDLE.offers.map(o => ({ ...o, id: r.offerIds.get(o.id)! }))
    await client.query(
      `INSERT INTO product_offers (id, ${OFFER_COLUMNS.join(', ')})
       SELECT id, ${OFFER_COLUMNS.join(', ')} FROM jsonb_populate_recordset(NULL::product_offers, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET ${OFFER_COLUMNS.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`,
      [JSON.stringify(offers)]
    )
    const ids = offers.map(o => o.id)
    await client.query(
      `UPDATE product_offers SET is_active = false, updated_at = now() WHERE is_active AND NOT (id = ANY($1::uuid[]))`,
      [ids]
    )
    await client.query(`DELETE FROM product_offer_items WHERE offer_id = ANY($1::uuid[])`, [ids])
    const items = offers.flatMap(o => o.items.flatMap(p => (r.products.map.has(p) ? [[o.id, r.products.map.get(p)!]] : [])))
    if (items.length)
      await client.query(
        `INSERT INTO product_offer_items (offer_id, product_id)
         SELECT (x->>0)::uuid, (x->>1)::uuid FROM jsonb_array_elements($1::jsonb) x ON CONFLICT DO NOTHING`,
        [JSON.stringify(items)]
      )
    await client.query(
      `INSERT INTO gallery_images (${GALLERY_COLUMNS.join(', ')})
       SELECT ${GALLERY_COLUMNS.join(', ')} FROM jsonb_populate_recordset(NULL::gallery_images, $1::jsonb) g
       WHERE NOT EXISTS (SELECT 1 FROM gallery_images x WHERE x.id = g.id OR (g.s3_key IS NOT NULL AND x.s3_key = g.s3_key))`,
      [JSON.stringify(BUNDLE.gallery)]
    )
    return r.ids
  })

  const sections = remap(BUNDLE.sections, ids) as unknown as DraftSection[]
  const heroSlides = remap(BUNDLE.heroSlides, ids) as unknown as DraftHeroSlide[]
  await withHomepageDraft(null, draft => {
    draft.sections = sections
    draft.heroSlides = heroSlides
  })
  await publishHomepageDraft()
  return plan
}
