import { NextRequest, NextResponse } from 'next/server'
import { getProduct } from '@/lib/queries'
import { query } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { revalidatePath } from 'next/cache'

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await req.json()
  const { category_id } = body
  if (!category_id) return NextResponse.json({ error: 'category_id required' }, { status: 400 })

  await query('UPDATE products SET category_id = $1, updated_at = $2 WHERE id = $3', [
    category_id, new Date().toISOString(), params.id,
  ])
  revalidatePath('/admin/products')
  revalidatePath('/admin/categories')
  return NextResponse.json({ ok: true })
}
