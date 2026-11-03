import { NextRequest, NextResponse } from 'next/server'
import { clearPortalCookie } from '@/lib/auth/portal-session'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return clearPortalCookie(NextResponse.json({ ok: true }), request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
}
