import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCustomerById } from '@/lib/queries'
import { query } from '@/lib/db'
import { logActivity } from '@/lib/activity'
import { createAutoTask, completeAutoTask } from '@/lib/auto-tasks'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin || !hasScope(admin.role, admin.scopes, 'customers:read')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const customer = await getCustomerById(id)
    return NextResponse.json(customer)
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch customer' }, { status: 404 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const admin = await authenticateAdmin(request)
    if (!admin || !hasScope(admin.role, admin.scopes, 'customers:write')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action, reason } = await request.json()

    if (action === 'flag') {
      await query('UPDATE users SET is_flagged = true, is_active = false, flag_reason = $1 WHERE id = $2', [
        reason || 'Flagged by admin',
        id,
      ])
      logActivity({
        userId: id,
        actorId: admin.adminId,
        kind: 'flagged',
        summary: `Account flagged${reason ? `: ${reason}` : ''}`,
        metadata: { reason: reason || null },
      }).catch(() => {})
      createAutoTask({
        userId: id,
        sourceKind: 'review_flagged',
        sourceRefId: id,
        title: `Review flagged account`,
        description: reason || 'Account was flagged. Investigate and decide whether to keep flagged or reactivate.',
        priority: 'urgent',
        dueInDays: 0,
      }).catch(() => {})
    } else if (action === 'deactivate') {
      await query('UPDATE users SET is_active = false WHERE id = $1', [id])
      logActivity({
        userId: id,
        actorId: admin.adminId,
        kind: 'profile_updated',
        summary: 'Account deactivated',
      }).catch(() => {})
    } else if (action === 'activate') {
      await query('UPDATE users SET is_active = true, is_flagged = false, flag_reason = null WHERE id = $1', [id])
      logActivity({
        userId: id,
        actorId: admin.adminId,
        kind: 'unflagged',
        summary: 'Account reactivated',
      }).catch(() => {})
      completeAutoTask('review_flagged', id, { actorAdminId: admin.adminId }).catch(() => {})
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}
