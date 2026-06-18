import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { updateLocation, deleteLocation } from '@/lib/shelf'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await request.json()
    const fields: any = {}
    if (body.aisle_code !== undefined) fields.aisle_code = body.aisle_code.trim()
    if (body.rack_code !== undefined) fields.rack_code = body.rack_code.trim()
    if (body.shelf_code !== undefined) fields.shelf_code = body.shelf_code.trim()
    if ('bin_code' in body) fields.bin_code = body.bin_code?.trim() || null
    if (body.notes !== undefined) fields.notes = body.notes?.trim() || null
    if (body.is_active !== undefined) fields.is_active = Boolean(body.is_active)

    const location = await updateLocation(id, fields)
    return NextResponse.json({ location })
  } catch (e: any) {
    if (e.message === 'Location not found') return NextResponse.json({ error: e.message }, { status: 404 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(_request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await deleteLocation(id)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    if (e.message?.includes('Cannot delete')) return NextResponse.json({ error: e.message }, { status: 409 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
