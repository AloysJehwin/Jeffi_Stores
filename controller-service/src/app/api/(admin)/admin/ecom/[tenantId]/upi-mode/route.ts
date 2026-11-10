import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { getTenant, setUpiMode } from '@/lib/tenant-registry'
import { invalidateUpiModeCache } from '@/lib/payments/upi/creds'

export const dynamic = 'force-dynamic'

// The platform admin's UPI switch for a store. The provider itself (PhonePe / its UPI ID) follows what the store saved.
const Mode = z.enum(['auto', 'off'])
const PatchSchema = z.object({ mode: Mode.optional(), upi_mode: Mode.optional() }).refine(b => b.mode || b.upi_mode, { message: 'mode is required' })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const parsed = parseBody(PatchSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const mode = (parsed.data.mode ?? parsed.data.upi_mode)!

  await setUpiMode(tenantId, mode)
  invalidateUpiModeCache(tenantId)
  return NextResponse.json({ success: true, mode, upi_mode: mode })
}
