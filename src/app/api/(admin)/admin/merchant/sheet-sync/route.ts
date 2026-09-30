import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { syncAllProductsToSheet } from '@/lib/shared/google-sheets'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'merchant_sync:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const testLimit: number | undefined = body.testLimit ? Number(body.testLimit) : undefined

  try {
    const result = await syncAllProductsToSheet(testLimit)
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Sheet sync failed' }, { status: 500 })
  }
}
