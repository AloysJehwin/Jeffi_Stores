import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listReorderIntervals, ReorderIntervalsInputSchema, saveReorderIntervals } from '@/lib/campaigns/reorder-intervals'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

// Per-category reorder intervals used by the Replenishment campaign.

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  try {
    return NextResponse.json({ categories: await listReorderIntervals() })
  } catch {
    return NextResponse.json({ error: 'Could not load the categories' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'campaigns:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const parsed = parseBody(ReorderIntervalsInputSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  try {
    const updated = await saveReorderIntervals(parsed.data)
    return NextResponse.json({ updated, categories: await listReorderIntervals() })
  } catch {
    return NextResponse.json({ error: 'Could not save the reorder intervals' }, { status: 500 })
  }
}
