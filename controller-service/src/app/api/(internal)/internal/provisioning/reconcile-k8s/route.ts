import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { reconcileK8sPlan } from '@/lib/provisioning/steps'
import { getProvisioningProvider } from '@/lib/provisioning'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Re-applies every active store's namespace, so each runs its controller, messaging and document pods
// at the release images. deploy/k8s/bootstrap/rollout.sh calls it after the platform rolls; idempotent.
// ?slug= limits it to one store. Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.PROVISIONING_COMPUTE !== 'k8s') return NextResponse.json({ error: 'Not in k8s mode' }, { status: 400 })
  const slug = request.nextUrl.searchParams.get('slug')
  const { rows } = await controlPlanePool().query<{ id: string; slug: string }>(
    `SELECT t.id, t.slug FROM tenants t JOIN tenant_infra i ON i.tenant_id = t.id
      WHERE t.status = 'active' AND 'store' = ANY(t.service_types) AND i.rds_endpoint IS NOT NULL
        AND ($1::text IS NULL OR t.slug = $1)
      ORDER BY t.slug`,
    [slug]
  )
  const provider = getProvisioningProvider()
  const tenants: { slug: string; ok: boolean; error: string | null }[] = []
  for (const t of rows) {
    const r = await reconcileK8sPlan(t.id, provider, { force: true }).catch((e: any) => ({ ok: false, error: e?.message as string }))
    tenants.push({ slug: t.slug, ok: r.ok, error: r.error ?? null })
  }
  return NextResponse.json({ success: tenants.every(t => t.ok), tenants })
}
