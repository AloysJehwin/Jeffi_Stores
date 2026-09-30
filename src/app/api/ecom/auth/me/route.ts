import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ owner: null }, { status: 200 })
  const tenants = await getOwnerTenants(owner.id)
  return NextResponse.json({ owner: { id: owner.id, email: owner.email, name: owner.name }, tenants })
}
