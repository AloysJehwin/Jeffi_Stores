import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { recomputeHealth, getHealth } from '@/lib/customer-health'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const health = await getHealth(params.id)
  return NextResponse.json({ health })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const health = await recomputeHealth(params.id)
  if (!health) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ health })
}
