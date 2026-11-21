import { NextRequest, NextResponse, after } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getTenant } from '@/lib/tenant-registry'
import { queueRecheck } from '@controller/lib/kyb/analyze'

export const dynamic = 'force-dynamic'

// The KYC tab's "Run checks again": every document the store has on file, KYB and licences, except approved ones, is
// marked as being checked and read again after the response.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId } = await params
  if (!(await getTenant(tenantId).catch(() => null))) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const job = await queueRecheck(tenantId, { all: true, licences: true })
  if (job.count) after(job.run)
  return NextResponse.json({ ok: true, count: job.count })
}
