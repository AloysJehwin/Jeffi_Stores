import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { backfillAsins } from '@/lib/amazon/asin-backfill'

// Backfill Amazon ASINs onto variants/products by matching the live catalog. Read-only vs Amazon,
// but a DB write when dryRun=false, so gated behind products:write + CSRF. maxDuration=300 —
// matching thousands of SKUs takes minutes.
export const maxDuration = 300

function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const host = request.headers.get('host')
  if (!host) return false
  const expected = new Set([`https://${host}`, `http://${host}`])
  if (origin && expected.has(origin)) return true
  if (referer) {
    try { return new URL(referer).host === host } catch { return false }
  }
  return false
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }
  if (request.headers.get('x-requested-with') !== 'jeffi-admin') {
    return NextResponse.json({ error: 'Missing required header' }, { status: 403 })
  }

  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  try {
    const report = await backfillAsins({
      dryRun: body.dryRun !== false, // default dry run
      brand: typeof body.brand === 'string' && body.brand ? body.brand : undefined,
      limit: Number(body.limit) || undefined,
    })
    return NextResponse.json({ success: true, report })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Backfill failed' }, { status: 500 })
  }
}
