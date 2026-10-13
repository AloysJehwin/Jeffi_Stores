// Nightly WhatsApp approval sync — iterates all tenants that have at least one WA
// variant with a provider_ref and calls POST /wa/sync-approval against each.
//
// Run manually:  node --import tsx scripts/wa-approval-sync.ts
// In k8s:        CronJob at 02:17 UTC daily hitting this script image.
//
// Uses an internal service token (claims.internal=true, no tenantId) to fetch
// the tenant list from the control plane, then re-signs per tenant to hit /wa/sync-approval.

import { createHmac } from 'node:crypto'
import { db } from '../src/db.js'

const MESSAGING_URL = (process.env.MESSAGING_URL || 'http://localhost:3101').replace(/\/$/, '')

function token(tenantId: string, tenantSlug: string): string {
  const secret = process.env.SERVICE_AUTH_SECRET
  if (!secret) throw new Error('SERVICE_AUTH_SECRET is not set')
  const payload = JSON.stringify({ service: 'cron', internal: true, tenantId, tenantSlug, exp: Math.floor(Date.now() / 1000) + 300 })
  const sig = createHmac('sha256', secret).update(payload).digest()
  return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`
}

async function main() {
  const tenants = await db.query<{ tenant_id: string; slug: string }>(
    `SELECT DISTINCT t.id AS tenant_id, t.slug
       FROM tenant t
       JOIN template_variant tv ON tv.tenant_id = t.id
      WHERE tv.provider_ref IS NOT NULL
        AND tv.approval_status NOT IN ('approved','rejected','disabled')`
  )
  let total = 0, totalChanged = 0
  for (const row of tenants.rows) {
    try {
      const r = await fetch(`${MESSAGING_URL}/wa/sync-approval`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token(row.tenant_id, row.slug)}`, 'content-type': 'application/json' },
        body: '{}',
      })
      const data = await r.json().catch(() => ({}))
      total += data.checked ?? 0
      totalChanged += data.changed ?? 0
      console.log(`[wa-sync] tenant=${row.slug} checked=${data.checked ?? 0} changed=${data.changed ?? 0}`)
    } catch (e: any) {
      console.warn(`[wa-sync] tenant=${row.slug} failed: ${e?.message || e}`)
    }
  }
  console.log(`[wa-sync] done — ${tenants.rowCount ?? 0} tenants, ${total} checked, ${totalChanged} changed`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
