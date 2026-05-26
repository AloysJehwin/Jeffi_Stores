import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { listWarehouses, createWarehouse } from '@/lib/shelf'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const warehouses = await listWarehouses()
    return NextResponse.json({ warehouses })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'inventory')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { name, code, address } = await request.json()
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (!code?.trim()) return NextResponse.json({ error: 'code required' }, { status: 400 })

    const warehouse = await createWarehouse(name.trim(), code.trim(), address?.trim() || null)
    return NextResponse.json({ warehouse }, { status: 201 })
  } catch (e: any) {
    if (e.message?.includes('unique') || e.code === '23505') {
      return NextResponse.json({ error: 'Warehouse code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
