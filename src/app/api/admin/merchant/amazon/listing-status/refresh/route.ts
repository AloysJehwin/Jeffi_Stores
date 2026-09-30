import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { refreshAmazonStatusSnapshot } from '@/lib/amazon/status'

export const dynamic = 'force-dynamic'
// Refresh can take a couple of minutes (pages through all Amazon listings).
export const maxDuration = 300

function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const host = request.headers.get('host')
  if (!host) return false
  const expected = new Set([`https://${host}`, `http://${host}`])
  if (origin && expected.has(origin)) return true
  if (referer) {
    try {
      const refUrl = new URL(referer)
      if (refUrl.host === host) return true
    } catch {
      return false
    }
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
  if (!hasScope(admin.role, admin.scopes, 'merchant_sync:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const result = await refreshAmazonStatusSnapshot()
    if ('locked' in result) {
      return NextResponse.json({ error: 'A refresh is already in progress' }, { status: 409 })
    }
    return NextResponse.json({ success: true, summary: result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Refresh failed' }, { status: 500 })
  }
}
