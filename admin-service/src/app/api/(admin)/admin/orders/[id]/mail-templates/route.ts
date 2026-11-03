import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { orderMailTemplates } from '@/lib/orders/customer-mail'

export const dynamic = 'force-dynamic'

// GET — the email templates offered for this order (Show on: Order page), the ones that suit its state first.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'orders:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const r = await orderMailTemplates(id)
  if (!r) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  return NextResponse.json(r)
}
