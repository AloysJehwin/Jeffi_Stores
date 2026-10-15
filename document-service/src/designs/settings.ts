import type pg from 'pg'
import sharp from 'sharp'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { getPdf, putObject } from '../storage.js'
import { isFontKey, isHexColor, resolveDesign } from './index.js'
import type { Branding, FontKey } from './model.js'

export interface DocSettings { design: string | null; accent: string | null; font: FontKey | null; logo_key: string | null }
export interface CallBranding { logo_url?: string; accent?: string; font?: string }

const EMPTY: DocSettings = { design: null, accent: null, font: null, logo_key: null }

export async function getSettings(db: pg.Pool, tenantId: string): Promise<DocSettings> {
  const r = await db.query<DocSettings>(`SELECT design, accent, font, logo_key FROM document_settings WHERE tenant_id=$1`, [tenantId])
  return r.rows[0] ?? EMPTY
}

const bad = (message: string) => Object.assign(new Error(message), { status: 400, code: 'validation_error' })

export async function saveSettings(db: pg.Pool, tenantId: string, b: { design?: string | null; accent?: string | null; font?: string | null }) {
  if (b.design != null && !resolveDesign(b.design)) throw bad(`Unknown design '${b.design}'`)
  if (b.accent != null && !isHexColor(b.accent)) throw bad('accent must be a #rrggbb colour')
  if (b.font != null && !isFontKey(b.font)) throw bad(`Unknown font '${b.font}'`)
  await db.query(
    `INSERT INTO document_settings (tenant_id, design, accent, font) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET design=$2, accent=$3, font=$4, updated_at=now()`,
    [tenantId, b.design ?? null, b.accent ?? null, b.font ?? null]
  )
  return getSettings(db, tenantId)
}

export const normalizeLogo = (buf: Buffer) =>
  sharp(buf).resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true }).png().toBuffer()

export async function saveLogo(db: pg.Pool, tenantId: string, raw: Buffer | null) {
  let key: string | null = null
  if (raw) {
    key = `${tenantId}/branding/logo.png`
    await putObject(key, await normalizeLogo(raw).catch(() => { throw bad('logo must be a PNG, JPEG, WebP or SVG image') }), 'image/png')
  }
  await db.query(
    `INSERT INTO document_settings (tenant_id, logo_key) VALUES ($1,$2)
     ON CONFLICT (tenant_id) DO UPDATE SET logo_key=$2, updated_at=now()`, [tenantId, key])
  return getSettings(db, tenantId)
}

export const loadLogo = (key: string | null) => (key ? getPdf(key).catch(() => null) : Promise.resolve(null))

const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd]|fe80)/i
// Per-call logo URLs are fetched server-side: https only, public addresses, 2 MB, 5 s.
async function fetchLogo(url: string): Promise<Buffer> {
  let u: URL
  try { u = new URL(url) } catch { throw bad('branding.logo_url must be a valid URL') }
  if (u.protocol !== 'https:') throw bad('branding.logo_url must be https')
  const addr = isIP(u.hostname) ? u.hostname : (await lookup(u.hostname).catch(() => { throw bad('branding.logo_url host not found') })).address
  if (PRIVATE.test(addr)) throw bad('branding.logo_url must be a public address')
  const r = await fetch(u, { signal: AbortSignal.timeout(5000), redirect: 'error' }).catch(() => null)
  if (!r?.ok) throw bad('branding.logo_url could not be fetched')
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length > 2_000_000) throw bad('branding.logo_url is larger than 2 MB')
  return normalizeLogo(buf).catch(() => { throw bad('branding.logo_url is not an image') })
}

/** Workspace settings, overridden field-by-field by the call. */
export async function resolveBranding(db: pg.Pool, tenantId: string, template?: string | null, call?: CallBranding | null) {
  const s = await getSettings(db, tenantId)
  if (call?.accent != null && !isHexColor(call.accent)) throw bad('branding.accent must be a #rrggbb colour')
  if (call?.font != null && !isFontKey(call.font)) throw bad(`Unknown branding.font '${call.font}'`)
  const branding: Branding = {
    accent: call?.accent ?? s.accent ?? undefined,
    font: (call?.font as FontKey) ?? s.font ?? undefined,
    logo: call?.logo_url ? await fetchLogo(call.logo_url) : await loadLogo(s.logo_key),
  }
  return { design: template ?? s.design ?? null, branding }
}
