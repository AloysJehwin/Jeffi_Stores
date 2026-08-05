import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { syncAllProductsToAmazon, syncProductToAmazon, sendAmazonSyncFailureEmail } from '@/lib/amazon/sync'

// Full push pages one PUT per SKU (~3000 variants) with backoff — allow up to 5 min.
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
    } catch { return false }
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
  if (!hasScope(admin.role, admin.scopes, 'products:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const productId: string | undefined = body.productId

  try {
    if (productId) {
      await syncProductToAmazon(productId)
      return NextResponse.json({ success: true, mode: 'single' })
    }

    const result = await syncAllProductsToAmazon()
    if (result.errors.length > 0) {
      await sendAmazonSyncFailureEmail(result)
    }
    return NextResponse.json({ success: true, mode: 'full', ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`

  if (!isCron) {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'products:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const result = await syncAllProductsToAmazon()
    if (result.errors.length > 0) {
      await sendAmazonSyncFailureEmail(result)
    }
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
