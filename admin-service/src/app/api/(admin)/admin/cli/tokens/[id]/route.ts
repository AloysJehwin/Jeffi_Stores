import { NextRequest, NextResponse } from 'next/server'
import { signedInAdmin } from '@/lib/auth/admin-principal'
import { revokeApiToken } from '@/lib/auth/api-tokens'
import { isPlatformOwner } from '@/lib/auth/scopes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Revoke one token: your own, or (the store's owner) anyone's, service-account keys included.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await signedInAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ok = await revokeApiToken({ id, tenantId: admin.tenantId, adminId: isPlatformOwner(admin.role) ? undefined : admin.adminId })
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
