import { NextResponse } from 'next/server'
import { clearPortalCookie } from '@/lib/portal-session'

export const dynamic = 'force-dynamic'

export async function POST() {
  return clearPortalCookie(NextResponse.json({ ok: true }))
}
