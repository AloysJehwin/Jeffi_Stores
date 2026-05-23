import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getPLReport } from '@/lib/financial'
import { getFinancialYear } from '@/lib/gst'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'financial')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { searchParams } = new URL(request.url)

    const now = new Date()
    const fyStart = now.getMonth() >= 3
      ? `${now.getFullYear()}-04-01`
      : `${now.getFullYear() - 1}-04-01`
    const fyEnd = now.getMonth() >= 3
      ? `${now.getFullYear() + 1}-03-31`
      : `${now.getFullYear()}-03-31`

    const from = searchParams.get('from') || fyStart
    const to = searchParams.get('to') || fyEnd

    const result = await getPLReport(from, to)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
