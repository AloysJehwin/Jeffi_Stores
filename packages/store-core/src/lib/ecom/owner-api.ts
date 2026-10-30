import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, type Owner, type TenantRow } from '@/lib/tenant-registry'
import { TENANT_COOKIE } from './owner-context'

/** Shared guard for owner-session API routes: resolves owner + the current tenant (cookie or ?tenant=). */
export async function ownerApi(request: NextRequest): Promise<{ owner: Owner; tenant: TenantRow; tenants: TenantRow[] } | NextResponse> {
  const jar = await cookies()
  const owner = await resolveOwnerSession(jar.get(OWNER_COOKIE)?.value, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const tenants = await getOwnerTenants(owner.id)
  const wanted = request.nextUrl.searchParams.get('tenant') ?? jar.get(TENANT_COOKIE)?.value
  const tenant = (wanted && tenants.find(t => t.slug === wanted)) || tenants.find(t => t.status === 'active') || tenants[0]
  if (!tenant) return NextResponse.json({ error: 'No tenant' }, { status: 404 })
  return { owner, tenant, tenants }
}
