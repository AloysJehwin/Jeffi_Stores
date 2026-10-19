// One-shot: give every tenant a v2 WhatsApp template_family at each legacy system/*
// slug (cloned from the current platform catalog), then archive the legacy row.
//
// Why: the legacy message_templates WA rows use named {{brand}} placeholders. Twilio's
// numeric content-variables filter in send.ts has always dropped these silently, so brand
// never actually rendered. Phase 0 shifted the WA catalog to the positional
// {{1}} = store_name convention; this backfill brings tenants onto that shape so the
// legacy findTemplate fallback can be removed in the same commit.
//
// Idempotent: skips a slug if the tenant already has a v2 template_family at it.
// Safe to re-run.
//
// Run: pnpm --filter messaging-service tsx scripts/backfill-legacy-wa-to-v2.ts

import { db } from '../src/db.js'
import * as tpl from '../src/templates-v2.js'
import { CATALOG, type TemplateSeed } from '../seed/catalog.js'
import { poolsForTenant } from '../src/pools.js'

// Legacy named-placeholder slugs → the current v2 catalog slug whose body replaces them.
// The v2 copy is written AT THE LEGACY SLUG so existing callers keep working; the body/blocks
// come from the mapped catalog entry (Phase 0: brand at {{1}}).
const LEGACY_TO_V2: Record<string, string> = {
  'system/otp':                'otp/verify',
  'system/order-confirmation': 'order/confirmed',
  'system/promo-offer':        'promo/offer',
  'system/cart-reminder':      'cart/abandoned',
  'system/delivery-update':    'order/shipped',
}
const LEGACY_SLUGS = Object.keys(LEGACY_TO_V2)

async function main() {
  const waByCatalogSlug = new Map<string, TemplateSeed>(
    CATALOG.filter(c => c.channel === 'whatsapp').map(c => [c.slug, c])
  )

  const { rows: tenants } = await db.query<{ id: string }>(`SELECT id FROM tenants ORDER BY id`)

  for (const t of tenants) {
    const tenantId = t.id
    let pool: import('pg').Pool
    let pools: tpl.Pools
    try {
      const p = await poolsForTenant(tenantId)
      pool = p.pool as import('pg').Pool
      pools = p.pools
    } catch (e) {
      console.warn(`${tenantId}: skipped — ${(e as Error).message}`)
      continue
    }

    let backfilled = 0
    for (const legacySlug of LEGACY_SLUGS) {
      const v2Slug = LEGACY_TO_V2[legacySlug]
      const seed = waByCatalogSlug.get(v2Slug)
      if (!seed) continue

      // Already migrated? Idempotency.
      const existing = await tpl.findBySlug(pools.tenant, tenantId, 'whatsapp', legacySlug).catch(() => null)
      if (existing) continue

      // Clone the catalog body into a v2 family at the LEGACY slug (keeps callers working).
      // No provider_ref: the new {{1}} body needs a fresh Meta submission; until approved, sends
      // without a tenant provider_ref fall through to the platform catalog default (same body).
      await tpl.upsertTemplate(pool, tenantId, {
        slug: legacySlug,
        channel: 'whatsapp',
        name: seed.name,
        category: seed.category,
        description: `Backfilled from legacy ${legacySlug} (body cloned from v2 ${v2Slug}).`,
        body: seed.body,
        blocks: seed.blocks,
        blocks_format: seed.blocks_format,
        meta_category: seed.meta_category,
        note: `backfill-legacy-wa-to-v2: cloned from ${v2Slug}`,
        publish: true,
      })
      backfilled++
    }

    // Archive this tenant's own active legacy WA rows (the body no longer wins over v2 and the
    // fallback is being removed).
    const archived = await db.query(
      `UPDATE message_templates SET status='archived', updated_at=now()
         WHERE tenant_id=$1 AND channel='whatsapp' AND status='active' AND slug = ANY($2::text[])`,
      [tenantId, LEGACY_SLUGS]
    )

    if (backfilled > 0 || (archived.rowCount ?? 0) > 0)
      console.log(`${tenantId}: backfilled ${backfilled} legacy WA templates to v2`)
  }

  // Platform-wide shared system/* WA rows (tenant_id IS NULL): archive — they would otherwise still
  // be returned by any caller that still queried the legacy table directly.
  const sys = await db.query(
    `UPDATE message_templates SET status='archived', updated_at=now()
       WHERE tenant_id IS NULL AND channel='whatsapp' AND status='active' AND slug = ANY($1::text[])`,
    [LEGACY_SLUGS]
  )
  if ((sys.rowCount ?? 0) > 0) console.log(`platform: archived ${sys.rowCount} legacy WA system rows`)

  await db.end()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
