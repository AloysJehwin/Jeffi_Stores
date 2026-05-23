import { NextRequest, NextResponse } from 'next/server'
import { getProduct } from '@/lib/queries'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  try {
    const product = await getProduct(params.id)
    return NextResponse.json(product)
  } catch (err: any) {
    if (err.message === 'Product not found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
