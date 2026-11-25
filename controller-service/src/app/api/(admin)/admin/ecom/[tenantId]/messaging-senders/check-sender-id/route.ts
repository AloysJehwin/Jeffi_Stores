import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { checkSenderId } from '@/lib/messaging/dlt-sender-check'

export const dynamic = 'force-dynamic'

// Read-only "Check sender ID": is ?header= registered on the platform's AWS account in ap-south-1. Platform admins only.

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const header = request.nextUrl.searchParams.get('header') ?? ''
  try {
    return NextResponse.json(await checkSenderId(header))
  } catch (e: any) {
    const bad = /letters or digits/.test(e?.message ?? '')
    return NextResponse.json({ error: bad ? e.message : 'Could not check the sender ID on AWS' }, { status: bad ? 400 : 502 })
  }
}
