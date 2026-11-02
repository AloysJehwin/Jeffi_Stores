import { NextRequest, NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/shared/cron-auth'
import { updateAllTenantS3Usage } from '@controller/lib/billing/s3-usage'

export const dynamic = 'force-dynamic'

/** Nightly: list each tenant bucket, sum sizes, write s3_usage_bytes + s3_usage_updated_at. */
export async function GET(req: NextRequest) {
  if (!verifyCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await updateAllTenantS3Usage().catch(e => ({ error: String(e) }))
  if ('error' in r) return NextResponse.json(r, { status: 500 })
  return NextResponse.json({ ok: true, ...r })
}
