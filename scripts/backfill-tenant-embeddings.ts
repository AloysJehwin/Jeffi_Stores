#!/usr/bin/env node
// One-time (or ad-hoc) per-tenant product embedding backfill into each tenant's OWN DB.
// The embed_sync cron keeps them fresh after this; use this to seed existing tenants.
//
//   npx tsx scripts/backfill-tenant-embeddings.ts --tenant <slug>   # one tenant
//   npx tsx scripts/backfill-tenant-embeddings.ts --all             # every active tenant
//   npx tsx scripts/backfill-tenant-embeddings.ts --flagship        # the platform store (no tenant ctx)
//
// Reads products from, and writes embeddings into, the tenant's own database (via db.ts tenant pool).
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()
import { runWithTenantContext, type TenantContext } from '@/lib/tenancy/tenant-context'
import { lookupTenantContextBySlug, listTenants } from '@/lib/tenant-registry'
import { backfillProductEmbeddings } from '@/lib/shared/embed-products'

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : ''
}

async function runOne(label: string, ctx: TenantContext | null): Promise<void> {
  const fn = () => backfillProductEmbeddings({ onlyMissing: true })
  const result = ctx ? await runWithTenantContext(ctx, fn) : await fn()
  console.log(
    `[${label}] total=${result.total} embedded=${result.embedded} skipped=${result.skipped} failed=${result.failed}`
  )
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

  console.error('usage: --tenant <slug> | --all | --flagship')
  process.exit(2)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err?.message || err)
    process.exit(1)
  })
