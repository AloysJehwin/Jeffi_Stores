import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getLastAmazonSyncStatus, isAmazonSyncRunning } from '@/lib/amazon/sync'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'merchant_sync:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const [status, running] = await Promise.all([getLastAmazonSyncStatus(), isAmazonSyncRunning()])
  return NextResponse.json({ status: status ?? null, running })
}
