import { NextResponse } from 'next/server'
import { clearStaffCookie } from '@/lib/staff-session'

export const dynamic = 'force-dynamic'

export async function POST() {
  return clearStaffCookie(NextResponse.json({ ok: true }))
}
