import 'server-only'
import type { QueryResult, QueryResultRow } from 'pg'
import { computeBlurhash } from '@/lib/shared/s3'

// Blurhashes for images stored before the columns existed: every image column with a blurhash beside it, hashed
// from the thumbnail when there is one (the hash is taken at 32px, so it matches the full image's). Rows are walked
// in id order with a cursor, so an image that can't be fetched is passed over instead of retried forever.

export const BLURHASH_COLUMNS = [
  { table: 'gallery_images', hash: 'blurhash', url: 'COALESCE(thumbnail_url, image_url)' },
  { table: 'product_images', hash: 'blurhash', url: 'COALESCE(thumbnail_url, image_url)' },
  { table: 'variant_images', hash: 'blurhash', url: 'COALESCE(thumbnail_url, image_url)' },
  { table: 'gallery_videos', hash: 'blurhash', url: 'thumbnail_url' },
  { table: 'hero_slides', hash: 'blurhash', url: 'image_url' },
  { table: 'hero_slides', hash: 'blurhash_mobile', url: 'image_url_mobile' },
  { table: 'product_offers', hash: 'blurhash', url: 'image_url' },
  { table: 'product_offers', hash: 'blurhash_mobile', url: 'image_url_mobile' },
  { table: 'product_offers', hash: 'blurhash_card', url: 'image_url_card' },
] as const

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

export interface Cursor {
  col: number
  after: string | null
}

const PAGE = 24
const CONCURRENCY = 2
const MAX_BYTES = 25 * 1024 * 1024
const NOT_IMAGE = /\.(?:mp4|webm|mov|m3u8)(?:[?#]|$)/i
// A table or column this DB doesn't have yet (an older tenant schema): nothing to do there.
const missingRelation = (err: unknown) => ['42P01', '42703'].includes((err as { code?: string } | null)?.code ?? '')

// Some uploads stored '' instead of null; both mean no blurhash.
const unhashed = (c: (typeof BLURHASH_COLUMNS)[number]) => `COALESCE(${c.hash}, '') = ''`
const pending = (c: (typeof BLURHASH_COLUMNS)[number]) => `${unhashed(c)} AND ${c.url} IS NOT NULL AND ${c.url} <> ''`

/** Rows still without a blurhash, per column. */
export async function countMissingBlurhashes(db: Db) {
  const out: { table: string; column: string; missing: number }[] = []
  for (const c of BLURHASH_COLUMNS) {
    try {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${c.table} WHERE ${pending(c)}`)
      out.push({ table: c.table, column: c.hash, missing: rows[0].n })
    } catch (err) {
      if (!missingRelation(err)) throw err
    }
  }
  return out
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > MAX_BYTES ? null : buf
  } catch {
    return null
  }
}

/**
 * Hashes from `from` until the columns run out (next = null) or `deadline` passes (next = where to resume).
 * `site` resolves site-relative paths. Writes only rows still without one, so it is safe to re-run.
 */
export async function backfillBlurhashes(db: Db, from: Cursor, deadline: number, site: string) {
  let updated = 0
  const failed: string[] = []
  for (let col = from.col; col < BLURHASH_COLUMNS.length; col++) {
    const c = BLURHASH_COLUMNS[col]
    let after = col === from.col ? from.after : null
    for (;;) {
      if (Date.now() > deadline) return { next: { col, after }, updated, failed }
      let rows: { id: string; url: string }[]
      try {
        rows = (
          await db.query<{ id: string; url: string }>(
            `SELECT id::text, ${c.url} AS url FROM ${c.table}
              WHERE ${pending(c)} AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT ${PAGE}`,
            [after]
          )
        ).rows
      } catch (err) {
        if (missingRelation(err)) break
        throw err
      }
      if (!rows.length) break
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        await Promise.all(
          rows.slice(i, i + CONCURRENCY).map(async r => {
            const url = r.url.startsWith('/') ? `${site}${r.url}` : r.url
            const buf = /^https?:\/\//i.test(url) && !NOT_IMAGE.test(url) ? await fetchImage(url) : null
            const hash = buf ? await computeBlurhash(buf) : null
            if (!hash) return void failed.push(`${c.table}.${c.hash} ${r.id} ${url}`)
            const res = await db.query(`UPDATE ${c.table} SET ${c.hash} = $1 WHERE id = $2::uuid AND ${unhashed(c)}`, [
              hash,
              r.id,
            ])
            updated += res.rowCount ?? 0
          })
        )
      }
      after = rows[rows.length - 1].id
    }
  }
  return { next: null, updated, failed }
}
