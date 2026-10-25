#!/usr/bin/env node
// Report only (never writes): the large PNG gallery images a WebP re-encode would shrink, and every
// table/column that references each one. A real backfill needs new keys plus a rewrite of every
// reference, and anything a product photo, email, WhatsApp, push or ad uses must stay PNG, so this
// prints the plan instead of acting on it.
//
//   npx tsx scripts/report-gallery-webp.ts                 # PNGs >= 500 KB, biggest first
//   npx tsx scripts/report-gallery-webp.ts --min-kb 200 --limit 500
//
// Reads the DB in DATABASE_URL (.env.local); run it against a local copy, not production.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { queryMany } from '@/lib/shared/db'

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// References from these must stay PNG (see uploadGalleryImage in lib/shared/s3.ts).
const KEEP_PNG = /^(product_images|product_variant_images|email_|campaign|messaging_|wa_|whatsapp|push_|social_|meta_ads|google_ads)/

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`

async function main() {
  const minBytes = arg('min-kb', 500) * 1024
  const limit = arg('limit', 200)
  const images = await queryMany<{ id: string; s3_key: string; file_size: number; width: number; height: number }>(
    `SELECT id, s3_key, file_size, width, height FROM gallery_images
      WHERE mime_type = 'image/png' AND s3_key IS NOT NULL AND file_size >= $1
      ORDER BY file_size DESC LIMIT $2`,
    [minBytes, limit]
  )
  if (!images.length) {
    console.log(`No PNG gallery images of ${minBytes / 1024} KB or more.`)
    return
  }

  const columns = await queryMany<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name <> 'gallery_images'
        AND c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY')`
  )

  // key -> ["table.column x n"]
  const refs = new Map<string, Map<string, number>>(images.map(i => [i.s3_key, new Map()]))
  for (const { table_name, column_name } of columns) {
    const col = `${ident(table_name)}.${ident(column_name)}`
    const rows = await queryMany<{ v: string }>(
      `SELECT ${col}::text AS v FROM ${ident(table_name)} WHERE ${col}::text LIKE '%gallery/%'`
    ).catch(() => [])
    if (!rows.length) continue
    for (const img of images) {
      const n = rows.filter(r => r.v.includes(img.s3_key)).length
      if (n) refs.get(img.s3_key)!.set(`${table_name}.${column_name}`, n)
    }
  }

  let convertible = 0
  let bytes = 0
  for (const img of images) {
    const where = refs.get(img.s3_key)!
    const pinned = [...where.keys()].some(k => KEEP_PNG.test(k))
    if (!pinned) {
      convertible++
      bytes += Number(img.file_size)
    }
    const list = [...where].map(([k, n]) => `${k}${n > 1 ? ` x${n}` : ''}`).join(', ') || 'gallery only'
    console.log(
      `${pinned ? 'keep-png' : 'convert '}  ${(Number(img.file_size) / 1024).toFixed(0).padStart(6)} KB  ${img.width}x${img.height}  ${img.s3_key}  <- ${list}`
    )
  }
  console.log(
    `\n${images.length} PNGs listed; ${convertible} (${(bytes / 1024 / 1024).toFixed(1)} MB) referenced only by WebP-safe places. Nothing was changed.`
  )
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err?.message || err)
    process.exit(1)
  })
