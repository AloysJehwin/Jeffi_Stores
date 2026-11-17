// Run with tsx (global-setup.ts does): one throwaway site draft per pack, the pack applied, a preview token for each,
// written to output/manifest.json. cleanup.ts deletes the drafts. Published site_pages / site_theme are never
// written: the storefront renders the draft through `?preview=<token>` (lib/site/page.ts, preview.ts).
import fs from 'node:fs'
import path from 'node:path'
import { loadLocalEnv } from './env'
import { CHROME_PAGES, DRAFT_TITLE_PREFIX, MANIFEST_PATH, OUTPUT_DIR, PAGE_PATHS, type Audience, type Manifest, type ManifestDraft, type Skipped, type SweepPage } from './pages'

loadLocalEnv()

const baseUrl = (process.env.SWEEP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

/** Whether the app behind a path answers. The dev router replies 502 "<app> isn't running" for an app that is down. */
async function appUp(url: string): Promise<boolean> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 5_000)
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'manual' })
    return !(res.status === 502 && /isn't running/.test(await res.text()))
  } catch (err) {
    if (ctl.signal.aborted) return true // answering, still compiling
    throw new Error(`nothing answers at ${url} (${err instanceof Error ? err.message : err}); start the dev server first`)
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.local)')
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set (the preview token is signed with it)')
  const { sitePacks } = await import('@/lib/site/packs')
  const { createSiteDraft, discardSiteDraft, getSiteDraft } = await import('@/lib/site/store')
  const { applySitePack } = await import('@/lib/site/apply-pack')
  const { signHomepagePreviewToken } = await import('@/lib/catalog/homepage-preview-token')
  const { queryOne, queryMany } = await import('@/lib/shared/db')

  const up: Record<Audience, boolean> = { store: await appUp(`${baseUrl}/`), business: await appUp(`${baseUrl}/business`) }

  // Drafts a crashed earlier run left behind (ours only, by title).
  for (const d of await queryMany<{ id: string }>(`SELECT id FROM site_drafts WHERE title LIKE $1`, [`${DRAFT_TITLE_PREFIX}%`])) {
    await discardSiteDraft(d.id)
  }

  const product = await queryOne<{ slug: string }>(`SELECT slug FROM products WHERE is_active = true ORDER BY created_at LIMIT 1`).catch(() => null)
  const only = process.env.SWEEP_PACKS?.split(',').map(s => s.trim()).filter(Boolean)
  const drafts: ManifestDraft[] = []
  const skipped: Skipped[] = []
  for (const pack of sitePacks()) {
    if (only?.length && !only.includes(pack.id) && !only.includes(pack.id.replace(/^pack:/, ''))) continue
    const audience: Audience = pack.pages[0]?.audience === 'business' ? 'business' : 'store'
    const archetype = pack.archetype ?? pack.id
    if (!up[audience]) {
      skipped.push({ archetype, pack: pack.id, page: null, reason: `the ${audience === 'store' ? 'storefront' : 'business'} app is not running` })
      continue
    }
    const pages: SweepPage[] = []
    for (const key of [...new Set(pack.pages.map(p => p.page as string))]) {
      if (CHROME_PAGES.includes(key)) continue
      const at = PAGE_PATHS[audience][key]
      if (!at) skipped.push({ archetype, pack: pack.id, page: key, reason: 'no storefront path in PAGE_PATHS (tests/responsive/pages.ts)' })
      else if (key === 'product' && !product) skipped.push({ archetype, pack: pack.id, page: key, reason: 'no active product in the database' })
      else pages.push({ page: key, ...at })
    }
    let draftId = ''
    try {
      draftId = await createSiteDraft(null, `${DRAFT_TITLE_PREFIX}${pack.id}`)
      if (!(await applySitePack(draftId, pack.id, null))) throw new Error(`pack ${pack.id} not applied`)
      const draft = await getSiteDraft(draftId)
      const blocks: Record<string, string> = {}
      for (const doc of Object.values(draft?.docs.pages ?? {})) {
        for (const [id, b] of Object.entries(doc.blocks)) blocks[id] = b.type
      }
      drafts.push({
        packId: pack.id,
        name: pack.name,
        archetype,
        audience,
        draftId,
        token: await signHomepagePreviewToken({ draftId, audience, kind: 'site' }),
        blocks,
        pages,
      })
    } catch (err) {
      for (const id of [draftId, ...drafts.map(d => d.draftId)]) if (id) await discardSiteDraft(id)
      throw err
    }
  }
  if (drafts.length === 0) throw new Error(`no pack to sweep (${skipped.map(s => `${s.archetype}: ${s.reason}`).join('; ') || 'SWEEP_PACKS matched none'})`)

  const manifest: Manifest = { baseUrl, productSlug: product?.slug ?? null, createdAt: new Date().toISOString(), drafts, skipped }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true })
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
  for (const f of ['findings.jsonl', 'summary.json', 'summary.md', 'screenshots']) fs.rmSync(path.join(OUTPUT_DIR, f), { recursive: true, force: true })
  process.stdout.write(`[sweep] ${drafts.length} throwaway drafts (${drafts.map(d => d.archetype).join(', ') || 'none'}); product ${product?.slug ?? 'none'}\n`)
  for (const s of skipped) process.stdout.write(`[sweep] skipped ${s.archetype}${s.page ? ` / ${s.page}` : ''}: ${s.reason}\n`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[sweep] prepare failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
