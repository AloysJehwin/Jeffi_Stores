import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getTenant, getProvisioningJob, setTenantInstanceState } from '@/lib/tenant-registry'
import { getProvisioningProvider } from '@/lib/provisioning'
import { dbInstanceId } from '@/lib/provisioning/steps'

export const dynamic = 'force-dynamic'

// Disable/enable a tenant's RDS to save cost. GATED TO slug 'test' ONLY — a real
// paying tenant's store must stay up, so this refuses any other tenant server-side.
// body: { action: 'disable' | 'enable' }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (admin.role !== 'super_admin' && !hasScope(admin.role, admin.scopes, 'ecom_instances:read')) {
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
  const instId = (job?.created_resources as any)?.dbInstanceId || dbInstanceId(tenant.slug)
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
