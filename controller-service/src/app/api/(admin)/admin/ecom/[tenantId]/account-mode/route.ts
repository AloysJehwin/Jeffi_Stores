import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant, setOwnRazorpay } from '@/lib/tenant-registry'
import { resolveRazorpayCreds } from '@/lib/integrations/resolve'

export const dynamic = 'force-dynamic'

const PatchSchema = z.object({ own_razorpay: z.boolean() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const parsed = parseBody(PatchSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { own_razorpay } = parsed.data

  // Enabling own-Razorpay without connected, decryptable creds would leave the platform holding the
  // cash while the code skips the Route transfer — the tenant would never be paid. Refuse it.
  if (own_razorpay) {
    const { isOwn } = await resolveRazorpayCreds(tenantId).catch(() => ({ isOwn: false }))
    if (!isOwn) {
      return NextResponse.json(
        { error: 'Cannot enable own-Razorpay: tenant has no connected Razorpay credentials.' },
        { status: 409 }
      )
    }
  }

  await setOwnRazorpay(tenantId, own_razorpay)
  return NextResponse.json({ success: true, own_razorpay })
}
