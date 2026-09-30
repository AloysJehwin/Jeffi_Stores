import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { isPlatformAdmin } from '@/lib/scopes'
import { parseBody } from '@/lib/validate'
import { getTenant, setOwnDelhivery } from '@/lib/tenant-registry'
import { hasOwnDelhiveryToken } from '@/lib/integrations/resolve'

export const dynamic = 'force-dynamic'

const PatchSchema = z.object({ own_delhivery: z.boolean() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  const tenant = await getTenant(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const parsed = parseBody(PatchSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { own_delhivery } = parsed.data

  // Enabling own-Delhivery without a connected token would leave the tenant unable to create AWBs
  // (the resolver would fall back to the platform token, which own-mode is meant to avoid). Refuse it.
  if (own_delhivery && !(await hasOwnDelhiveryToken(tenantId))) {
    return NextResponse.json(
      { error: 'Cannot enable own-Delhivery: tenant has no connected Delhivery token.' },
      { status: 409 }
    )
  }

  await setOwnDelhivery(tenantId, own_delhivery)
  return NextResponse.json({ success: true, own_delhivery })
}
