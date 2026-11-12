import { query } from '@/lib/shared/db'
import { getSiteControls } from '@/lib/catalog/site-controls'
import {
  DEFAULT_MEDIA_LIMITS,
  MEDIA_KINDS,
  type MediaLimits,
  type ProductMediaItem,
  type StagedMedia,
} from './product-media-shared'

export * from './product-media-shared'

// product_media is the one place a product's media lives (product, variant or sub-variant scope).
// Images at product / variant scope are kept in product_images / variant_images too, under the same
// id, until every reader has moved: applyProductMediaTx writes them from product_media, and
// syncLegacyImagesToMedia copies the other way after code that still writes the old tables.

type Db = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }
const pool: Db = { query: (t, p) => query(t, p) as any }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COLS = `m.id, m.kind, m.url, m.thumbnail_url, m.s3_key, m.s3_thumbnail_key, m.file_name, m.mime,
  m.size_bytes::float8 AS size_bytes, m.width, m.height, m.duration_seconds::float8 AS duration_seconds,
  m.alt, m.caption, m.sort_order, m.is_primary, m.status, m.metadata, m.product_id, m.variant_id, m.sub_variant_id, m.created_at`

// Scopes that inherit (use_own_* off) are left out, so resolveMedia can fall through to the parent.
const EFFECTIVE = `(m.variant_id IS NULL OR EXISTS (SELECT 1 FROM product_variants v WHERE v.id = m.variant_id AND v.use_own_images AND v.is_active))
  AND (m.sub_variant_id IS NULL OR EXISTS (SELECT 1 FROM product_sub_variants sv WHERE sv.id = m.sub_variant_id AND sv.use_own_media AND sv.is_active))`

/** Every media row of a product, all scopes. `raw` keeps rows of scopes that currently inherit (editor). */
export async function loadProductMedia(productId: string, opts: { raw?: boolean; db?: Db } = {}): Promise<ProductMediaItem[]> {
  const r = await (opts.db ?? pool).query(
    `SELECT ${COLS} FROM product_media m
      WHERE m.root_product_id = $1 ${opts.raw ? '' : `AND m.status = 'ready' AND ${EFFECTIVE}`}
      ORDER BY m.sort_order, m.created_at`,
    [productId]
  )
  return r.rows as ProductMediaItem[]
}

/** Media for several products at once (feeds, listings): product id → rows. */
export async function loadProductMediaMany(productIds: string[], db: Db = pool): Promise<Map<string, ProductMediaItem[]>> {
  const out = new Map<string, ProductMediaItem[]>()
  if (productIds.length === 0) return out
  const r = await db.query(
    `SELECT m.root_product_id, ${COLS} FROM product_media m
      WHERE m.root_product_id = ANY($1::uuid[]) AND m.status = 'ready' AND ${EFFECTIVE}
      ORDER BY m.sort_order, m.created_at`,
    [productIds]
  )
  for (const row of r.rows) {
    const { root_product_id, ...item } = row
    const list = out.get(root_product_id) ?? []
    list.push(item as ProductMediaItem)
    out.set(root_product_id, list)
  }
  return out
}

export async function getMediaLimits(): Promise<MediaLimits> {
  try {
    return (await getSiteControls()).media ?? DEFAULT_MEDIA_LIMITS
  } catch {
    return DEFAULT_MEDIA_LIMITS
  }
}

const baseName = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() || 'file').slice(0, 255)

const SAME = `(kind, url, s3_key, thumbnail_url, s3_thumbnail_key, file_name, mime, size_bytes, width, height,
  duration_seconds, alt, caption, sort_order, is_primary, status, metadata, product_id, variant_id, sub_variant_id)`

/**
 * Makes live product_media equal the staged list (rows of scopes that inherit are dropped), applies
 * staged sub-variant switches, then rewrites product_images / variant_images from it. Rows keep
 * their id, so an untouched item is not written at all.
 */
export async function applyProductMediaTx(client: Db, productId: string, staged: StagedMedia): Promise<void> {
  const variants = (await client.query(`SELECT id, use_own_images FROM product_variants WHERE product_id = $1`, [productId])).rows
  for (const [id, on] of Object.entries(staged.own_sub ?? {})) {
    if (!UUID_RE.test(id)) continue
    await client.query(
      `UPDATE product_sub_variants SET use_own_media = $3, updated_at = NOW()
        WHERE id = $1 AND product_id = $2 AND use_own_media IS DISTINCT FROM $3`,
      [id, productId, !!on]
    )
  }
  const subs = (await client.query(`SELECT id, use_own_media FROM product_sub_variants WHERE product_id = $1`, [productId])).rows
  const ownVariant = new Set(variants.filter(v => v.use_own_images).map(v => v.id))
  const ownSub = new Set(subs.filter(s => s.use_own_media).map(s => s.id))

  const seen = new Set<string>()
  const items = (Array.isArray(staged.items) ? staged.items : [])
    .filter(m => m && UUID_RE.test(String(m.id)) && (MEDIA_KINDS as readonly string[]).includes(m.kind) && m.url)
    .filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .filter(m => (m.sub_variant_id ? ownSub.has(m.sub_variant_id) : m.variant_id ? ownVariant.has(m.variant_id) : true))
    .map(m => ({
      id: m.id,
      kind: m.kind,
      url: m.url,
      s3_key: m.s3_key ?? null,
      thumbnail_url: m.thumbnail_url ?? null,
      s3_thumbnail_key: m.s3_thumbnail_key ?? null,
      file_name: (m.file_name || baseName(m.url)).slice(0, 255),
      mime: m.mime ?? null,
      size_bytes: m.size_bytes ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      duration_seconds: m.duration_seconds ?? null,
      alt: m.alt ? String(m.alt).slice(0, 255) : null,
      caption: m.caption ? String(m.caption).slice(0, 500) : null,
      sort_order: Number.isFinite(Number(m.sort_order)) ? Math.round(Number(m.sort_order)) : 0,
      is_primary: !!m.is_primary,
      status: m.status || 'ready',
      metadata: m.metadata && typeof m.metadata === 'object' ? m.metadata : {},
      product_id: m.sub_variant_id || m.variant_id ? null : productId,
      variant_id: m.sub_variant_id ? null : (m.variant_id ?? null),
      sub_variant_id: m.sub_variant_id ?? null,
    }))
  const json = JSON.stringify(items)
  const rows = `jsonb_to_recordset($2::jsonb) AS n(id uuid, kind text, url text, s3_key text, thumbnail_url text,
    s3_thumbnail_key text, file_name text, mime text, size_bytes bigint, width int, height int, duration_seconds numeric,
    alt text, caption text, sort_order int, is_primary boolean, status text, metadata jsonb,
    product_id uuid, variant_id uuid, sub_variant_id uuid)`

  await client.query(`DELETE FROM product_media WHERE root_product_id = $1 AND id <> ALL($2::uuid[])`, [productId, items.map(m => m.id)])
  await client.query(
    `UPDATE product_media m SET
       kind = n.kind, url = n.url, s3_key = n.s3_key, thumbnail_url = n.thumbnail_url, s3_thumbnail_key = n.s3_thumbnail_key,
       file_name = n.file_name, mime = n.mime, size_bytes = n.size_bytes, width = n.width, height = n.height,
       duration_seconds = n.duration_seconds, alt = n.alt, caption = n.caption, sort_order = n.sort_order,
       is_primary = n.is_primary, status = n.status, metadata = n.metadata,
       product_id = n.product_id, variant_id = n.variant_id, sub_variant_id = n.sub_variant_id, updated_at = NOW()
     FROM ${rows}
    WHERE m.id = n.id AND m.root_product_id = $1
      AND (m.kind::text, m.url, m.s3_key, m.thumbnail_url, m.s3_thumbnail_key, m.file_name::text, m.mime::text, m.size_bytes, m.width,
           m.height, m.duration_seconds, m.alt::text, m.caption::text, m.sort_order, m.is_primary, m.status::text, m.metadata,
           m.product_id, m.variant_id, m.sub_variant_id)
          IS DISTINCT FROM
          (n.kind, n.url, n.s3_key, n.thumbnail_url, n.s3_thumbnail_key, n.file_name, n.mime, n.size_bytes, n.width,
           n.height, n.duration_seconds, n.alt, n.caption, n.sort_order, n.is_primary, n.status, n.metadata,
           n.product_id, n.variant_id, n.sub_variant_id)`,
    [productId, json]
  )
  await client.query(
    `INSERT INTO product_media (id, root_product_id, ${SAME.slice(1, -1)})
     SELECT n.id, $1, n.kind, n.url, n.s3_key, n.thumbnail_url, n.s3_thumbnail_key, n.file_name, n.mime, n.size_bytes, n.width,
            n.height, n.duration_seconds, n.alt, n.caption, n.sort_order, n.is_primary, n.status, n.metadata,
            n.product_id, n.variant_id, n.sub_variant_id
       FROM ${rows}
      WHERE NOT EXISTS (SELECT 1 FROM product_media m WHERE m.id = n.id)`,
    [productId, json]
  )
  await writeLegacyImagesTx(client, productId)
}

// product_images / variant_images := product_media images at product / variant scope.
async function writeLegacyImagesTx(client: Db, productId: string): Promise<void> {
  const bucket = process.env.S3_BUCKET_NAME || 'jeffi-stores-bucket'
  // Mirror writes: product_media's own trigger logs the change once, and the legacy 5-image
  // trigger on product_images yields to the media limit.
  await client.query(`SELECT set_config('audit.skip', 'true', true), set_config('product_media.mirror', 'true', true)`)
  try {
    await writeLegacyRows(client, productId, bucket)
  } finally {
    // On a failed statement the tx is already aborted; don't mask the real error.
    await client.query(`SELECT set_config('audit.skip', '', true), set_config('product_media.mirror', '', true)`).catch(() => {})
  }
}

async function writeLegacyRows(client: Db, productId: string, bucket: string): Promise<void> {
  for (const t of [
    { table: 'product_images', owner: 'product_id', scope: `m.product_id = $1`, mine: `l.product_id = $1` },
    {
      table: 'variant_images',
      owner: 'variant_id',
      scope: `m.variant_id IS NOT NULL`,
      mine: `l.variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)`,
    },
  ]) {
    // One primary per owner: the flagged row, else the first in order.
    const src = `(SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.${t.owner} ORDER BY m.is_primary DESC, m.sort_order, m.created_at) = 1 AS lead
                    FROM product_media m WHERE m.root_product_id = $1 AND m.kind = 'image' AND ${t.scope})`
    await client.query(`DELETE FROM ${t.table} l WHERE ${t.mine} AND NOT EXISTS (SELECT 1 FROM ${src} s WHERE s.id = l.id)`, [productId])
    // The primary moves in two steps (unique index on one primary per owner).
    await client.query(
      `UPDATE ${t.table} l SET is_primary = false WHERE ${t.mine} AND l.is_primary
         AND NOT EXISTS (SELECT 1 FROM ${src} s WHERE s.id = l.id AND s.lead)`,
      [productId]
    )
    await client.query(
      `UPDATE ${t.table} l SET image_url = s.url, thumbnail_url = s.thumbnail_url, s3_key = s.s3_key,
              s3_thumbnail_key = s.s3_thumbnail_key, file_name = COALESCE(s.file_name, l.file_name), file_size = s.size_bytes::int,
              mime_type = s.mime, width = s.width, height = s.height, alt_text = s.alt, display_order = s.sort_order,
              is_primary = s.lead, updated_at = NOW()
         FROM ${src} s
        WHERE l.id = s.id
          AND (l.image_url::text, l.thumbnail_url::text, l.s3_key::text, l.s3_thumbnail_key::text, l.file_size, l.mime_type::text, l.width,
               l.height, l.alt_text::text, l.display_order, l.is_primary)
              IS DISTINCT FROM
              (s.url, s.thumbnail_url, s.s3_key, s.s3_thumbnail_key, s.size_bytes::int, s.mime::text, s.width, s.height, s.alt::text, s.sort_order, s.lead)`,
      [productId]
    )
    await client.query(
      `INSERT INTO ${t.table} (id, ${t.owner}, image_url, thumbnail_url, s3_bucket, s3_key, s3_thumbnail_key, file_name, file_size,
              mime_type, width, height, blurhash, alt_text, display_order, is_primary)
       SELECT s.id, s.${t.owner}, s.url, s.thumbnail_url, $2, s.s3_key, s.s3_thumbnail_key, COALESCE(s.file_name, 'image'),
              s.size_bytes::int, s.mime, s.width, s.height, s.metadata->>'blurhash', s.alt, s.sort_order, s.lead
         FROM ${src} s
        WHERE NOT EXISTS (SELECT 1 FROM ${t.table} l WHERE l.id = s.id)
        ORDER BY s.lead DESC, s.sort_order`,
      [productId, bucket]
    )
  }
}

/**
 * product_media images at product / variant scope := product_images / variant_images. Run after any
 * code that still writes the old tables (imports, the create form, the live variant-image route).
 */
export async function syncLegacyImagesToMedia(productId: string, db: Db = pool): Promise<void> {
  await db.query(
    `DELETE FROM product_media m
      WHERE m.root_product_id = $1 AND m.kind = 'image' AND m.sub_variant_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.id = m.id)
        AND NOT EXISTS (SELECT 1 FROM variant_images vi WHERE vi.id = m.id)`,
    [productId]
  )
  for (const from of [
    `SELECT i.id, i.product_id AS root, i.product_id, NULL::uuid AS variant_id, i.image_url, i.s3_key, i.thumbnail_url,
            i.s3_thumbnail_key, i.file_name, i.mime_type, i.file_size, i.width, i.height, i.alt_text, i.display_order,
            i.is_primary, i.blurhash
       FROM product_images i WHERE i.product_id = $1`,
    `SELECT vi.id, v.product_id AS root, NULL::uuid AS product_id, vi.variant_id, vi.image_url, vi.s3_key, vi.thumbnail_url,
            vi.s3_thumbnail_key, vi.file_name, vi.mime_type, vi.file_size, vi.width, vi.height, vi.alt_text, vi.display_order,
            vi.is_primary, vi.blurhash
       FROM variant_images vi JOIN product_variants v ON v.id = vi.variant_id WHERE v.product_id = $1`,
  ]) {
    await db.query(
      `INSERT INTO product_media AS m (id, root_product_id, product_id, variant_id, kind, url, s3_key, thumbnail_url,
              s3_thumbnail_key, file_name, mime, size_bytes, width, height, alt, sort_order, is_primary, metadata)
       SELECT l.id, l.root, l.product_id, l.variant_id, 'image', l.image_url, l.s3_key, l.thumbnail_url, l.s3_thumbnail_key,
              l.file_name, l.mime_type, l.file_size, l.width, l.height, l.alt_text, COALESCE(l.display_order, 0),
              COALESCE(l.is_primary, false),
              CASE WHEN l.blurhash IS NOT NULL THEN jsonb_build_object('blurhash', l.blurhash) ELSE '{}'::jsonb END
         FROM (${from}) l
       ON CONFLICT (id) DO UPDATE SET
         url = EXCLUDED.url, s3_key = EXCLUDED.s3_key, thumbnail_url = EXCLUDED.thumbnail_url,
         s3_thumbnail_key = EXCLUDED.s3_thumbnail_key, alt = EXCLUDED.alt, sort_order = EXCLUDED.sort_order,
         is_primary = EXCLUDED.is_primary, width = EXCLUDED.width, height = EXCLUDED.height, updated_at = NOW()
       WHERE (m.url, m.s3_key, m.thumbnail_url, m.s3_thumbnail_key, m.alt, m.sort_order, m.is_primary, m.width, m.height)
             IS DISTINCT FROM
             (EXCLUDED.url, EXCLUDED.s3_key, EXCLUDED.thumbnail_url, EXCLUDED.s3_thumbnail_key, EXCLUDED.alt, EXCLUDED.sort_order,
              EXCLUDED.is_primary, EXCLUDED.width, EXCLUDED.height)`,
      [productId]
    )
  }
}

/** syncLegacyImagesToMedia that never fails its caller: the old tables stay the source for images. */
export async function syncLegacyImagesToMediaSafe(productId: string, db?: Db): Promise<void> {
  try {
    await syncLegacyImagesToMedia(productId, db)
  } catch (e) {
    console.error('[product-media] legacy image sync failed for', productId, e)
  }
}

export interface ProductFaq {
  id?: string
  question: string
  answer: string
  sort_order?: number
  published?: boolean
}

export async function loadProductFaqs(productId: string, opts: { publishedOnly?: boolean; db?: Db } = {}): Promise<ProductFaq[]> {
  const r = await (opts.db ?? pool).query(
    `SELECT id, question, answer, sort_order, published FROM product_faqs
      WHERE product_id = $1 ${opts.publishedOnly ? 'AND published' : ''} ORDER BY sort_order, created_at`,
    [productId]
  )
  return r.rows
}

/** product_faqs := the staged list (array order is the sort order). Rows with a known id are kept. */
export async function applyProductFaqsTx(client: Db, productId: string, faqs: unknown): Promise<void> {
  if (!Array.isArray(faqs)) return
  const rows = faqs
    .map((f: any, i) => ({
      id: UUID_RE.test(String(f?.id ?? '')) ? String(f.id) : null,
      question: String(f?.question ?? '').trim(),
      answer: String(f?.answer ?? '').trim(),
      sort_order: i,
      published: f?.published !== false,
    }))
    .filter(f => f.question && f.answer)
  const json = JSON.stringify(rows)
  const src = `jsonb_to_recordset($2::jsonb) AS n(id uuid, question text, answer text, sort_order int, published boolean)`
  await client.query(
    `DELETE FROM product_faqs WHERE product_id = $1 AND id <> ALL($2::uuid[])`,
    [productId, rows.map(r => r.id).filter(Boolean)]
  )
  await client.query(
    `UPDATE product_faqs f SET question = n.question, answer = n.answer, sort_order = n.sort_order, published = n.published, updated_at = NOW()
       FROM ${src}
      WHERE f.id = n.id AND f.product_id = $1
        AND (f.question, f.answer, f.sort_order, f.published) IS DISTINCT FROM (n.question, n.answer, n.sort_order, n.published)`,
    [productId, json]
  )
  await client.query(
    `INSERT INTO product_faqs (id, product_id, question, answer, sort_order, published)
     SELECT COALESCE(n.id, gen_random_uuid()), $1, n.question, n.answer, n.sort_order, n.published
       FROM ${src}
      WHERE n.id IS NULL OR NOT EXISTS (SELECT 1 FROM product_faqs f WHERE f.id = n.id)`,
    [productId, json]
  )
}
