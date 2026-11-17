// Deletes every draft prepare.ts created (the manifest's, plus any titled with our prefix) and blanks the manifest's
// preview tokens. Runs from global teardown; after a killed run: npx tsx --tsconfig tsconfig.json tests/responsive/cleanup.ts
import fs from 'node:fs'
import { loadLocalEnv } from './env'
import { DRAFT_TITLE_PREFIX, MANIFEST_PATH, type Manifest } from './pages'

loadLocalEnv()

async function main() {
  const manifest = fs.existsSync(MANIFEST_PATH) ? (JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest) : null
  if (manifest) fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ ...manifest, drafts: manifest.drafts.map(d => ({ ...d, token: '' })) }, null, 2))
  if (!process.env.DATABASE_URL) return
  const { discardSiteDraft } = await import('@/lib/site/store')
  const { queryMany } = await import('@/lib/shared/db')
  const ids = new Set<string>(manifest?.drafts.map(d => d.draftId) ?? [])
  for (const d of await queryMany<{ id: string }>(`SELECT id FROM site_drafts WHERE title LIKE $1`, [`${DRAFT_TITLE_PREFIX}%`])) ids.add(d.id)
  let n = 0
  for (const id of ids) if (await discardSiteDraft(id)) n++
  process.stdout.write(`[sweep] deleted ${n} throwaway drafts\n`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[sweep] cleanup failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
