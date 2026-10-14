import { NextRequest, NextResponse } from 'next/server'
import { ownerApi } from '@/lib/ecom/owner-api'
import { controlPlanePool } from '@/lib/tenant-registry/shared'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const r = await controlPlanePool().query(`UPDATE api_keys SET status='revoked', revoked_at=now() WHERE id=$1 AND tenant_id=$2 AND status='active'`, [id, ctx.tenant.id])
  if (!r.rowCount) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
