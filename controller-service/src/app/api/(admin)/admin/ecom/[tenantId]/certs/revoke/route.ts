import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant } from '@/lib/tenant-registry'
import { revokeTenantAdminCert } from '@/lib/tenancy/tenant-ca'
import { revokePortalCerts } from '@/lib/tenancy/portal-certs'

export const dynamic = 'force-dynamic'

const Body = z.object({ serial: z.string().min(1).max(64) })

// Revoke a tenant admin certificate by serial. Platform-owner only. Flips BOTH the authoritative
// tenant_admin_certs registry (checked at mTLS auth by tenant-mtls.ts) AND the portal_certs
// download registry, so a revoked cert can neither authenticate nor be re-downloaded. There was no
// API caller for revokeTenantAdminCert before this route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const parsed = parseBody(Body, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response

  const revokedBy = admin.email || admin.adminId || 'platform-admin'
  const wasActive = await revokeTenantAdminCert(parsed.data.serial, revokedBy)
  await revokePortalCerts([parsed.data.serial])

  return NextResponse.json({ success: true, alreadyRevoked: !wasActive })
}
