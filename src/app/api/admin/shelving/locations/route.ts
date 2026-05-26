import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { listLocations, createLocation } from '@/lib/shelf'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const warehouseId = request.nextUrl.searchParams.get('warehouse_id') || undefined
    const locations = await listLocations(warehouseId)
    return NextResponse.json({ locations })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { warehouse_id, aisle_code, rack_code, shelf_code, bin_code, notes } = await request.json()
    if (!warehouse_id) return NextResponse.json({ error: 'warehouse_id required' }, { status: 400 })
    if (!aisle_code?.trim()) return NextResponse.json({ error: 'aisle_code required' }, { status: 400 })
    if (!rack_code?.trim()) return NextResponse.json({ error: 'rack_code required' }, { status: 400 })
    if (!shelf_code?.trim()) return NextResponse.json({ error: 'shelf_code required' }, { status: 400 })

    const location = await createLocation(
      warehouse_id,
      aisle_code.trim(),
      rack_code.trim(),
      shelf_code.trim(),
      bin_code?.trim() || null,
      notes?.trim() || null
    )
    return NextResponse.json({ location }, { status: 201 })
  } catch (e: any) {
    if (e.message?.includes('unique') || e.code === '23505') {
      return NextResponse.json({ error: 'Location already exists' }, { status: 409 })
    }
    if (e.message === 'Warehouse not found') return NextResponse.json({ error: e.message }, { status: 404 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
