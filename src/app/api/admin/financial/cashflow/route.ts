import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { getCashflow } from '@/lib/financial'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    const result = await getCashflow(from, to)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}
