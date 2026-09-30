import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { parseBody } from '@/lib/validate'
import { setSubVariantActive } from '@/lib/variant-status'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ is_active: z.boolean() })

// PATCH /api/admin/products/[id]/variants/[variantId]/sub-variants/[subVariantId] — switch a sub-variant on or off.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; variantId: string; subVariantId: string }> }
) {
  try {
    const { id, variantId, subVariantId } = await params
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'products:write'))
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const parsed = parseBody(bodySchema, await request.json())
    if (!parsed.ok) return parsed.response

    const updated = await setSubVariantActive(id, variantId, subVariantId, parsed.data.is_active)
    if (!updated) return NextResponse.json({ error: 'Sub-variant not found' }, { status: 404 })
    return NextResponse.json({ success: true, is_active: parsed.data.is_active })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to update sub-variant' }, { status: 500 })
  }
}
