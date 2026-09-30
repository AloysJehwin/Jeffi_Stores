import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant, purgeTenant } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

// Hard-delete a deprovisioned tenant: removes its S3 backup + all control-plane rows.
// IRREVERSIBLE — no restore. Platform-operator only, requires { confirm: true }. The owner's
// bank + Razorpay linked account are kept owner-scoped for re-onboarding.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'Delete requires { confirm: true }' }, { status: 400 })
  }

  const result = await purgeTenant(id)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true, deletedBackups: result.deletedBackups })
}
