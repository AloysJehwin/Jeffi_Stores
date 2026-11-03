import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getTenant, getProvisioningJob, setTenantInstanceState } from '@/lib/tenant-registry'
import { getProvisioningProvider } from '@controller/lib/provisioning'
import { dbInstanceId } from '@controller/lib/provisioning/steps'

export const dynamic = 'force-dynamic'

// Disable/enable a tenant's RDS to save cost. GATED TO slug 'test' ONLY — a real
// paying tenant's store must stay up, so this refuses any other tenant server-side.
// body: { action: 'disable' | 'enable' }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'ecom_instances:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // HARD GATE: only the test tenant can be toggled.
  if (tenant.slug !== 'test') {
    return NextResponse.json({ error: 'Instance disable is only available for the test tenant.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const action = body?.action
  if (action !== 'disable' && action !== 'enable') {
    return NextResponse.json({ error: 'action must be "disable" or "enable"' }, { status: 400 })
  }

  const job = await getProvisioningJob(id)
  const created = (job?.created_resources as any) || {}
  // A database on the store's own server has no RDS instance to stop; it stops with the server.
  if (tenant.iam_auth === false || created.computeSpec?.db?.mode === 'node') {
    return NextResponse.json({ error: 'This store runs its database on its own server; there is no RDS instance to stop.' }, { status: 409 })
  }
  const instId = created.dbInstanceId || dbInstanceId(tenant.slug)
  const provider = getProvisioningProvider()

  try {
    if (action === 'disable') {
      await provider.stopDbInstance(instId)
      await setTenantInstanceState(id, 'stopped')
    } else {
      await provider.startDbInstance(instId)
      await setTenantInstanceState(id, 'running')
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'RDS action failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, instanceState: action === 'disable' ? 'stopped' : 'running' })
}
