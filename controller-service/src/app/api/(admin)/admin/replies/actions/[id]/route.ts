import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { parseBody } from '@/lib/shared/validate'
import { decideAsAdmin } from '@/lib/replies/admin'

export const dynamic = 'force-dynamic'

const body = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(1000).nullable().optional() })

// POST — approve or reject what the AI read from a customer's reply. The record's write scope is
// checked against the request's scenario.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parseBody(body, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const r = await decideAsAdmin(id, { adminId: admin.adminId, hasScope: s => hasScope(admin.role, admin.scopes, s) }, parsed.data.decision, parsed.data.note)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true })
}
