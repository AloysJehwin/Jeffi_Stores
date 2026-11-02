import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants, getCustomDomain, deleteCustomDomain } from '@/lib/tenant-registry'

export const dynamic = 'force-dynamic'

async function auth(request: NextRequest, id: string) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return { error: 'Not signed in', status: 401 as const }
  const row = await getCustomDomain(id)
  if (!row) return { error: 'Domain not found', status: 404 as const }
  const tenants = await getOwnerTenants(owner.id)
  if (!tenants.find(t => t.id === row.tenant_id)) {
    return { error: 'Not authorized', status: 403 as const }
  }
  return { row }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await auth(request, id)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ domain: res.row })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await auth(request, id)
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status })
  await deleteCustomDomain(id, res.row.tenant_id)
  return NextResponse.json({ ok: true })
}
