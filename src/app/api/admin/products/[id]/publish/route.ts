import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne } from '@/lib/db'
import { publishProductDraft } from '@/lib/product-draft'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const draft = await queryOne<{ product_id: string }>(
      `SELECT product_id FROM product_drafts WHERE product_id = $1`,
      [id]
    )
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

    await publishProductDraft(id)
    return NextResponse.json({ success: true, productId: id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg || 'Failed to publish draft' }, { status: 500 })
  }
}
