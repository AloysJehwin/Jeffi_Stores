import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody, zEmail } from '@/lib/shared/validate'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { getTenant } from '@/lib/tenant-registry'
import { ensureOwnerAdmin } from '@controller/lib/tenancy/tenant-admin-provision'

export const dynamic = 'force-dynamic'

const Body = z.object({
  email: zEmail.optional(),
  name: z.string().trim().max(120).optional(),
  revokeExisting: z.boolean().optional(),
})

// Issue (or re-issue) a store's super_admin client certificate and email the portal invite. Platform
// admins only. Defaults to the store owner; another email becomes another super_admin, since a
// certificate's CN must match the admin who signs in with it. `revokeExisting` revokes that admin's
// other active certificates once the new one exists.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await requireAdminScope(request, 'ecom_customers:write')
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (!tenant.rds_endpoint) return NextResponse.json({ error: 'This store has no database yet.' }, { status: 409 })

  const parsed = parseBody(Body, (await request.json().catch(() => null)) ?? {})
  if (!parsed.ok) return parsed.response
  const { email, name, revokeExisting } = parsed.data

  const r = await ensureOwnerAdmin(tenantId, {
    force: true,
    revokeExisting: !!revokeExisting,
    email,
    name,
    revokedBy: admin.email || admin.adminId || 'platform-admin',
    refreshFleet: 'if-ca-created',
  })
  if (r.noOwner) return NextResponse.json({ error: 'No owner is linked to this store. Enter an email.' }, { status: 422 })
  if (!r.success) return NextResponse.json({ error: r.error || 'The certificate was not issued.' }, { status: 502 })

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'create',
    entityType: 'tenant_admin_cert',
    entityId: r.serial ?? null,
    summary: `Issued admin certificate ${r.serial} for ${tenant.slug} to ${r.email}${r.revoked.length ? `; revoked ${r.revoked.join(', ')}` : ''}`,
    metadata: { tenantId, email: r.email, revoked: r.revoked, emailed: r.emailed },
    request,
  })

  return NextResponse.json({
    serial: r.serial,
    issuedTo: r.email,
    expiresAt: r.expiresAt,
    emailed: r.emailed,
    revoked: r.revoked,
    ...(r.fleetError ? { fleetError: r.fleetError } : {}),
  })
}
