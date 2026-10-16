import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { registerConnectedMerchant } from '@/lib/merchant/registration'

export const dynamic = 'force-dynamic'

// "Enable Merchant API sync": registers our Google Cloud project with the connected Merchant Center
// account (one-time, using the store's own Google sign-in).
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const r = await registerConnectedMerchant()
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
