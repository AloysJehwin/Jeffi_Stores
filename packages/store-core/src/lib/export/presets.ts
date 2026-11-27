import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import type { ExportOptions, ExportPreset } from './types'
import { MAX_PRESET_NAME } from './types'

// Per admin, per export: the last-used choices (name '') and named presets.

export const MAX_PRESETS = 20

interface Row {
  id: string
  name: string
  options: ExportOptions
  updated_at: Date | string
}

const toPreset = (r: Row): ExportPreset => ({
  id: r.id,
  name: r.name,
  options: r.options,
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
})

export async function listPresets(adminId: string, key: string): Promise<{ presets: ExportPreset[]; last: ExportOptions | null }> {
  const rows = await queryMany<Row>(
    `SELECT id, name, options, updated_at FROM admin_export_presets
      WHERE admin_id = $1 AND export_key = $2
      ORDER BY (name = '') DESC, lower(name)`,
    [adminId, key]
  )
  const last = rows.find(r => r.name === '')
  return { presets: rows.filter(r => r.name !== '').map(toPreset), last: last?.options ?? null }
}

/** Upserts by (admin, key, name); '' is the last-used set. Null when the admin is at the cap. */
export async function savePreset(adminId: string, key: string, name: string, options: ExportOptions): Promise<ExportPreset | null> {
  const n = name.trim().slice(0, MAX_PRESET_NAME)
  if (n) {
    const r = await queryOne<{ count: number; exists: boolean }>(
      `SELECT COUNT(*)::int AS count, bool_or(lower(name) = lower($3)) AS exists
         FROM admin_export_presets WHERE admin_id = $1 AND export_key = $2 AND name <> ''`,
      [adminId, key, n]
    )
    if (r && !r.exists && r.count >= MAX_PRESETS) return null
  }
  const row = await queryOne<Row>(
    `INSERT INTO admin_export_presets (admin_id, export_key, name, options)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (admin_id, export_key, lower(name::text))
     DO UPDATE SET options = EXCLUDED.options, name = EXCLUDED.name, updated_at = now()
     RETURNING id, name, options, updated_at`,
    [adminId, key, n, JSON.stringify(options)]
  )
  return row ? toPreset(row) : null
}

export async function deletePreset(adminId: string, key: string, id: string): Promise<boolean> {
  const r = await queryOne<{ id: string }>(
    `DELETE FROM admin_export_presets WHERE id = $1 AND admin_id = $2 AND export_key = $3 AND name <> '' RETURNING id`,
    [id, adminId, key]
  )
  return !!r
}
