import { NextRequest, NextResponse } from 'next/server'
import { controlPlanePool } from '@/lib/tenant-registry'
import { reconcileLayout } from '@controller/lib/provisioning/layout-switch'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

// Advances one store's move off the old all-in-one app by a step (a failed move starts again). rollout.sh
// calls it per store until the status is `services`; the provisioning worker resumes a move left half done.
// Auth: Bearer ${CRON_SECRET}.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.PROVISIONING_COMPUTE !== 'k8s') return NextResponse.json({ error: 'Not in k8s mode' }, { status: 400 })
  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  const { rows } = await controlPlanePool().query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1`, [slug])
  if (!rows[0]) return NextResponse.json({ error: 'Store not found' }, { status: 404 })
  const r = await reconcileLayout(rows[0].id, { retry: true })
  return NextResponse.json({ success: r.ok, slug, ...r })
}
