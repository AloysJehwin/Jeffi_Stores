import { NextResponse } from 'next/server'
import type { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformOwner } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

type Admin = Awaited<ReturnType<typeof requireAdminScope>>

/** Settings → Providers APIs: the platform owner on the flagship only. A store admin (tenant resolved, or
 *  unresolvable) is refused whatever its role. */
export async function platformOwnerOnly(admin: Admin): Promise<Admin> {
  if (admin instanceof NextResponse) return admin
  const tenant = await resolveTenantId().catch(() => 'unknown')
  if (!isPlatformOwner(admin.role) || tenant) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}
