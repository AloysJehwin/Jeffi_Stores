import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { maskMobile, verifyAdminMobileCode } from '@/lib/auth/admin-mobile'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const Schema = z.object({ otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const r = await verifyAdminMobileCode(await resolveTenantId().catch(() => null), admin.adminId, parsed.data.otp)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ mobile: maskMobile(r.phone) })
}
