import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { updateWarehouse, deleteWarehouse } from '@/lib/shelf'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const fields: any = {}
    if (body.name !== undefined) fields.name = body.name.trim()
    if (body.code !== undefined) fields.code = body.code.trim()
    if (body.address !== undefined) fields.address = body.address?.trim() || null
    if (body.is_active !== undefined) fields.is_active = Boolean(body.is_active)

    const warehouse = await updateWarehouse(id, fields)
    return NextResponse.json({ warehouse })
  } catch (e: any) {
    if (e.message === 'Warehouse not found') return NextResponse.json({ error: e.message }, { status: 404 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(_request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory:write')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await deleteWarehouse(id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message?.includes('Cannot delete')) return NextResponse.json({ error: e.message }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
