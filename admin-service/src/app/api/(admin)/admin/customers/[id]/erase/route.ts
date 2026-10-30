import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { checkAccountDeletion, deleteCustomerAccount } from '@/lib/account/delete-account'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// Erase a customer's account on their emailed request (/legal/account-deletion), same as self-service.
export async function GET(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'customers:write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  return NextResponse.json(await checkAccountDeletion(id))
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const admin = await requireAdminScope(request, 'customers:write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  if (body?.confirm !== 'DELETE') return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 })

  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Customer request'
  const result = await deleteCustomerAccount(id, { via: 'admin', adminId: admin.adminId, reason })
  if (!result.ok) {
    if ('blockers' in result) return NextResponse.json({ error: result.blockers[0].message, blockers: result.blockers }, { status: 409 })
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  if (!result.alreadyDeleted) {
    await logAdminAudit({
      adminId: admin.adminId,
      action: 'delete',
      entityType: 'customer',
      entityId: id,
      summary: 'Erased customer account and personal data',
      metadata: { reason, summary: result.summary },
      request,
    })
  }
  return NextResponse.json({ deleted: true })
}
