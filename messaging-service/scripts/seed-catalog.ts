// Platform-tenant CATALOG seeder. Bypasses /system-templates/install (which
// requires a real tenant_context row); writes directly via upsertTemplate to
// the unified DB using the platform sentinel tenantId.
import { db } from '../src/db.js'
import * as tpl from '../src/templates-v2.js'
import { CATALOG, WA_APPROVED_SIDS } from '../seed/catalog.js'

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000'
const force = process.argv.includes('--force')

let created = 0, skipped = 0
for (const seed of CATALOG) {
  const existing = await tpl.findBySlug(db, PLATFORM_TENANT_ID, seed.channel, seed.slug, seed.locale ?? 'en')
  if (existing && !force) { skipped++; continue }
  const providerRef = seed.channel === 'whatsapp' ? WA_APPROVED_SIDS[seed.slug] : undefined
  await tpl.upsertTemplate(db, PLATFORM_TENANT_ID, {
    ...seed,
    provider_ref: providerRef ?? seed.provider_ref,
    publish: true,
  })
  created++
}
console.log(JSON.stringify({ created, skipped, total: CATALOG.length }))
await db.end()
