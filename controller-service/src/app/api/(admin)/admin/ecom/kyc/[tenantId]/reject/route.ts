import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { rejectKyc, getKyc, getOwnerById, getTenant, hasService, reviewServiceApproval, controlPlanePool } from '@/lib/tenant-registry'
import { sendKycRejectedEmail, sendServicesReviewedEmail } from '@/lib/shared/ecom-emails'

export const dynamic = 'force-dynamic'

const Schema = z.object({ note: z.string().min(1) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = await params
  const raw = await request.json().catch(() => null)
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Rejection note is required' }, { status: 400 })

  // API-only workspace: reject KYC + pending services but keep the workspace (no store to shut down).
  const tenant = await getTenant(tenantId)
  if (tenant && !hasService(tenant, 'store')) {
    await controlPlanePool().query(`UPDATE tenant_kyc SET status='rejected', reviewed_at=now(), reviewed_by=$2, reviewer_note=$3 WHERE tenant_id=$1`, [tenantId, admin.email ?? 'admin', parsed.data.note])
    const rejected = await reviewServiceApproval(tenantId, 'all-pending', 'rejected', admin.email ?? 'admin', parsed.data.note)
    const kyc = await getKyc(tenantId).catch(() => null)
    const owner = kyc ? await getOwnerById(kyc.owner_id).catch(() => null) : null
    if (owner && rejected.length) sendServicesReviewedEmail({ email: owner.email, name: owner.name }, tenant.display_name, rejected, 'rejected', parsed.data.note).catch(() => {})
    return NextResponse.json({ ok: true, services: rejected })
  }

  await rejectKyc(tenantId, admin.email ?? 'admin', parsed.data.note)

  // Notify owner
  const kyc = await getKyc(tenantId).catch(() => null)
  if (kyc) {
    const owner = await getOwnerById(kyc.owner_id).catch(() => null)
    if (owner) sendKycRejectedEmail({ email: owner.email, name: owner.name }, parsed.data.note).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
