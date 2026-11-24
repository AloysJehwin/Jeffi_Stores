// The visual editor's end-to-end tests' data (docs/plans/SITE_EDITOR_PLAN.md phase 6), on the jeffi_test DB only:
//   npx tsx --tsconfig tests/responsive/tsconfig.sweep.json tests/site-editor/seed.ts up|down
// up: site_editor_enabled on, a throwaway draft whose home page is the sweep's editor page (editor-pack.ts) plus one
// classic block, a preview token, and an admin session for the seeded admin; written to tests/ui-output/site-editor.json.
// down: the draft and session gone, the flag as it was, and a store that had no Site Builder pages empty again (up
// imports the homepage tables, or publishes this page, so the Site Builder shows its editor).
import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from '../responsive/env'

loadLocalEnv()

export const SEED_PATH = 'tests/ui-output/site-editor.json'
const TITLE = 'site-editor-e2e:'
const FLAG = 'site_editor_enabled'

export interface Seeded {
  draftId: string
  token: string
  /** The admin_sid cookie value. */
  sid: string
  sessionId: string
  /** The flag's value before (null: no row). */
  flagBefore: string | null
  /** The store had no Site Builder pages (or theme) before: down takes away what up published. */
  emptyBefore: { pages: boolean; theme: boolean }
  blocks: { hero: string; classic: string }
}

async function up() {
  const { createSiteDraft, discardSiteDraft, importLegacyLayouts, invalidateSiteCache, publishSiteDraft, saveDraftPage } = await import('@/lib/site/store')
  const { signHomepagePreviewToken } = await import('@/lib/catalog/homepage-preview-token')
  const { createSession } = await import('@/lib/auth/auth-sessions')
  const { query, queryMany, queryOne } = await import('@/lib/shared/db')
  const { editorHomeDoc } = await import('../responsive/editor-pack')

  for (const d of await queryMany<{ id: string }>(`SELECT id FROM site_drafts WHERE title LIKE $1`, [`${TITLE}%`])) await discardSiteDraft(d.id)
  const prior = fs.existsSync(SEED_PATH) ? (JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Partial<Seeded>) : null
  const before = prior && 'flagBefore' in prior ? (prior.flagBefore ?? null) : ((await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [FLAG]))?.value ?? null)
  await query(`INSERT INTO site_settings (key, value, updated_at) VALUES ($1, 'true', now()) ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`, [FLAG])

  const admin = await queryOne<{ id: string; role: string }>(`SELECT id, role FROM admins WHERE is_active = true AND role IN ('administrator', 'super_admin') ORDER BY created_at LIMIT 1`)
  if (!admin) throw new Error('no active administrator in the DB (seed jeffi_test with scripts/seed-test-db.sql)')

  const doc = await editorHomeDoc()
  const classic = 'ed-classic'
  doc.blocks[classic] = { id: classic, type: 'rich_text', v: 1, props: { heading: 'A classic block', body: 'Written in the forms editor, kept as it was.', align: 'center', width: 'wide' } }
  doc.order.splice(1, 0, classic)
  const home = (surface: 'web' | 'web_mobile') => ({ audience: 'store' as const, surface, page: 'home' as const, slug: '' })

  // The Site Builder page shows its editor once the store has pages: the homepage tables imported, else this page
  // published once (a test DB with no homepage either).
  const emptyBefore = prior?.emptyBefore ?? { pages: !(await queryOne(`SELECT 1 FROM site_pages LIMIT 1`)), theme: !(await queryOne(`SELECT 1 FROM site_theme LIMIT 1`)) }
  if (!(await queryOne(`SELECT 1 FROM site_pages LIMIT 1`))) {
    await importLegacyLayouts(admin.id)
    if (!(await queryOne(`SELECT 1 FROM site_pages LIMIT 1`))) {
      const base = await createSiteDraft(admin.id, `${TITLE}base`)
      await saveDraftPage(base, home('web'), doc, admin.id)
      await publishSiteDraft(base, admin.id)
    }
  }
  invalidateSiteCache()

  const draftId = await createSiteDraft(admin.id, `${TITLE}${new Date().toISOString()}`)
  for (const surface of ['web', 'web_mobile'] as const) await saveDraftPage(draftId, home(surface), doc, admin.id)

  const { sid, id } = await createSession({ principalType: 'admin', principalId: admin.id, ttlSeconds: 3600, role: admin.role, scopes: ['*'] })
  const seeded: Seeded = {
    draftId,
    token: await signHomepagePreviewToken({ draftId, audience: 'store', kind: 'site' }),
    sid,
    sessionId: id,
    flagBefore: before,
    emptyBefore,
    blocks: { hero: 'ed-hero', classic },
  }
  fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true })
  fs.writeFileSync(SEED_PATH, JSON.stringify(seeded, null, 2))
  process.stdout.write(`[site-editor e2e] draft ${draftId} on ${new URL(process.env.DATABASE_URL!).pathname.slice(1)}\n`)
}

async function down() {
  if (!fs.existsSync(SEED_PATH)) return
  const s = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Seeded
  const { discardSiteDraft, invalidateSiteCache } = await import('@/lib/site/store')
  const { revokeSession } = await import('@/lib/auth/auth-sessions')
  const { query, queryMany } = await import('@/lib/shared/db')
  for (const d of await queryMany<{ id: string }>(`SELECT id FROM site_drafts WHERE title LIKE $1`, [`${TITLE}%`])) await discardSiteDraft(d.id)
  await revokeSession(s.sid).catch(() => {})
  if (s.emptyBefore?.pages) {
    await query(`DELETE FROM site_versions`)
    await query(`DELETE FROM site_pages`)
  }
  if (s.emptyBefore?.theme) await query(`DELETE FROM site_theme`)
  if (s.flagBefore === null) await query(`DELETE FROM site_settings WHERE key = $1`, [FLAG])
  else await query(`UPDATE site_settings SET value = $2, updated_at = now() WHERE key = $1`, [FLAG, s.flagBefore])
  invalidateSiteCache()
  fs.rmSync(SEED_PATH, { force: true })
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  // These tests switch a store setting and write drafts: never on a real store's DB.
  if (!/test/i.test(new URL(url).pathname)) throw new Error(`refusing to seed ${new URL(url).pathname.slice(1)}: point DATABASE_URL at jeffi_test`)
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set (the preview token is signed with it)')
  const cmd = process.argv[2]
  if (cmd === 'up') return up()
  if (cmd === 'down') return down()
  throw new Error('usage: seed.ts up|down')
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[site-editor e2e] seed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
