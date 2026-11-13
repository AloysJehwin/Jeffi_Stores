import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { applyK8sStorePart, reconcileK8sPlan } from '@controller/lib/provisioning/steps'
import { getProvisioningProvider } from '@controller/lib/provisioning'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { STORE_PARTS, type StorePart } from '@/lib/k8s/tenant-workload'

export const dynamic = 'force-dynamic'

// Re-applies every active store's namespace, so each runs its storefront, admin, business, messaging and
// document pods at the release images (a store still on the old all-in-one app keeps that app's image until
// switch-layout moves it). Idempotent. ?slug= limits it to one store.
// ?part= re-applies one slice of each store, as the release pipeline rolls each service on its own
// (deploy/k8s/bootstrap/rollout.sh `stores <part>`): `shared` (namespace, routes, config, database) or one
// service's own objects; answers 500 when a store failed. Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.PROVISIONING_COMPUTE !== 'k8s') return NextResponse.json({ error: 'Not in k8s mode' }, { status: 400 })
  const slug = request.nextUrl.searchParams.get('slug')
  const part = request.nextUrl.searchParams.get('part') as 'shared' | StorePart | null
  if (part && part !== 'shared' && !STORE_PARTS.includes(part)) return NextResponse.json({ error: `Unknown part ${part}` }, { status: 400 })
  const { rows } = await controlPlanePool().query<{ id: string; slug: string }>(
    `SELECT t.id, t.slug FROM tenants t JOIN tenant_infra i ON i.tenant_id = t.id
      WHERE t.status = 'active' AND 'store' = ANY(t.service_types) AND i.rds_endpoint IS NOT NULL
        AND ($1::text IS NULL OR t.slug = $1)
      ORDER BY t.slug`,
    [slug]
  )
  const provider = getProvisioningProvider()
  const tenants: { slug: string; ok: boolean; error: string | null; runs?: boolean }[] = []
  for (const t of rows) {
    if (part) {
      const r = await applyK8sStorePart(t.id, part).catch((e: any) => ({ ok: false, runs: false, error: e?.message as string }))
      tenants.push({ slug: t.slug, ...r })
      continue
    }
    const r = await reconcileK8sPlan(t.id, provider, { force: true }).catch((e: any) => ({ ok: false, error: e?.message as string }))
    tenants.push({ slug: t.slug, ok: r.ok, error: r.error ?? null })
  }
  const success = tenants.every(t => t.ok)
  return NextResponse.json({ success, part, tenants }, { status: part && !success ? 500 : 200 })
}
