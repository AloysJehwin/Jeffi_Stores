import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { getTenant, listServiceApprovals, reviewServiceApproval, controlPlanePool } from '@/lib/tenant-registry'
import { sendServicesReviewedEmail } from '@/lib/shared/ecom-emails'

export const dynamic = 'force-dynamic'

/** Approve / reject one requested Messaging or Documents service for a workspace. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = z.object({ service: z.enum(['messaging', 'documents']), decision: z.enum(['approved', 'rejected']), note: z.string().max(1000).optional() })
    .refine(b => b.decision === 'approved' || !!b.note?.trim(), { message: 'A note is required to reject' })
    .safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const tenant = await getTenant(id)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  const { service, decision, note } = parsed.data
  const done = await reviewServiceApproval(id, [service], decision, admin.email ?? 'admin', note)
  if (!done.length) return NextResponse.json({ error: 'Nothing pending for that service' }, { status: 409 })
  const owner = (await controlPlanePool().query(
    `SELECT o.email, o.name FROM owner_tenants ot JOIN owners o ON o.id = ot.owner_id WHERE ot.tenant_id = $1 LIMIT 1`, [id])).rows[0]
  if (owner) sendServicesReviewedEmail(owner, tenant.display_name, done, decision, note).catch(() => {})
  return NextResponse.json({ ok: true, approvals: await listServiceApprovals(id) })
}
