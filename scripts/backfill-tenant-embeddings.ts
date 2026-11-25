#!/usr/bin/env node
// One-time (or ad-hoc) per-tenant product embedding backfill into each tenant's OWN DB.
// The embed_sync cron keeps them fresh after this; use this to seed existing tenants.
//
//   npx tsx scripts/backfill-tenant-embeddings.ts --tenant <slug>   # one tenant
//   npx tsx scripts/backfill-tenant-embeddings.ts --all             # every active tenant
//   npx tsx scripts/backfill-tenant-embeddings.ts --flagship        # the platform store (no tenant ctx)
//   add --force to re-embed everything regardless of content hash / embedding model
//
// Reads products from, and writes embeddings into, the tenant's own database (via db.ts tenant pool).
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import type { TenantContext } from '@/lib/tenancy/tenant-context'
import { lookupTenantContextBySlug, listTenants } from '@/lib/tenant-registry'
import { runStoreBackfill } from '@/lib/shared/embed-backfill-run'

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : ''
}

async function runOne(label: string, ctx: TenantContext | null): Promise<void> {
  await runStoreBackfill(label, ctx, { force: arg('force') !== undefined })
}

async function main() {
  if (arg('flagship') !== undefined) {
    await runOne('flagship', null)
    return
  }

  const slug = arg('tenant')
  if (slug) {
    const ctx = await lookupTenantContextBySlug(slug)
    if (!ctx) throw new Error(`tenant not found: ${slug}`)
    await runOne(slug, ctx)
    return
  }

  if (arg('all') !== undefined) {
    const tenants = await listTenants({ status: 'active' })
    for (const t of tenants) {
      const ctx = await lookupTenantContextBySlug(t.slug)
      if (!ctx) {
        console.warn(`[${t.slug}] skipped — no context`)
        continue
      }
      await runOne(t.slug, ctx)
    }
    return
  }

  console.error('usage: --tenant <slug> | --all | --flagship [--force]')
  process.exit(2)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err?.message || err)
    process.exit(1)
  })
