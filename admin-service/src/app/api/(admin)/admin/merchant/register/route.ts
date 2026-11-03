import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { registerConnectedMerchant } from '@/lib/merchant/registration'
import { readJson } from '@/lib/channels/route'

export const dynamic = 'force-dynamic'

// "Enable Merchant API sync": registers our Google Cloud project with the connected Merchant Center
// account (one-time, using the store's own Google sign-in).
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'merchant_sync:write')
  if (admin instanceof NextResponse) return admin
  const body = await readJson(request)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, message: 'Enter a valid email' }, { status: 400 })
  const r = await registerConnectedMerchant(email || null)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
