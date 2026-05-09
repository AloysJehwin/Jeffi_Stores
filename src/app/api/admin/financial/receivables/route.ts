import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { getReceivablesAging } from '@/lib/financial'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const customerPhone = searchParams.get('customerPhone') || ''
    const search = searchParams.get('search') || ''

    const result = await getReceivablesAging({
      from: from || undefined,
      to: to || undefined,
      customerPhone: customerPhone || undefined,
      search: search || undefined,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
