import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { adminMobile, maskMobile } from '@/lib/auth/admin-mobile'

export const dynamic = 'force-dynamic'

/** The signed-in admin's own mobile number, masked. */
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await adminMobile(admin.adminId)
  return NextResponse.json({ mobile: row?.mobile_verified_at ? maskMobile(row.mobile) : null, verifiedAt: row?.mobile_verified_at ?? null })
}
