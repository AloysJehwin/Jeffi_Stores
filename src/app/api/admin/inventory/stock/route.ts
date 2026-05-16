import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { getStockLedger, getStockValuation } from '@/lib/inventory'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'ledger'

    if (view === 'valuation') {
      const data = await getStockValuation()
      return NextResponse.json(data)
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = parseInt(searchParams.get('limit') || '50')
    const ledger = await getStockLedger({
      productId: searchParams.get('product_id') || undefined,
      search: searchParams.get('search') || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      limit,
      offset: (page - 1) * limit,
    })

    return NextResponse.json({ transactions: ledger.rows, total: ledger.total, page, limit })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
