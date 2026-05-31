import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import type { CampaignKind } from '@/lib/marketing'

export const dynamic = 'force-dynamic'

interface AgentAction {
  id: string
  admin_id: string
  conversation_id: string
  kind: string
  payload: any
  status: string
}

async function executeAction(action: AgentAction): Promise<{ result: any; error: string | null }> {
  switch (action.kind) {
    case 'send_test_email': {
      const { campaignKind, toEmail } = action.payload
      const r = await sendTestCampaignEmail(campaignKind as CampaignKind, toEmail)
      if (!r.ok) return { result: null, error: r.reason || 'Send failed' }
      return { result: { sentTo: toEmail, campaign: campaignKind }, error: null }
    }
    case 'toggle_campaign_enabled': {
      const { campaignKind, enabled } = action.payload
      const updated = await queryOne(
        `UPDATE campaigns SET enabled = $1, updated_at = NOW() WHERE kind = $2 RETURNING kind, name, enabled`,
        [!!enabled, campaignKind]
      )
      if (!updated) return { result: null, error: 'Campaign not found' }
      return { result: updated, error: null }
    }
    case 'mark_order_shipped': {
      const { orderId, awbNumber } = action.payload
      const updated = await queryOne(
        `UPDATE orders
         SET status = 'shipped', shipped_at = COALESCE(shipped_at, NOW()),
             awb_number = COALESCE($2, awb_number), updated_at = NOW()
         WHERE id = $1::uuid AND status NOT IN ('shipped','delivered','cancelled')
         RETURNING id::text, order_number, status, awb_number`,
        [orderId, awbNumber || null]
      )
      if (!updated) return { result: null, error: 'Order not found or already shipped/delivered/cancelled' }
      return { result: updated, error: null }
    }
    default:
      return { result: null, error: `Unknown action kind: ${action.kind}` }
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'agent')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const action = await queryOne<AgentAction>(
    `SELECT id::text, admin_id::text, conversation_id::text, kind, payload, status
     FROM admin_agent_actions WHERE id = $1::uuid LIMIT 1`,
    [params.id]
  )
  if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  if (action.admin_id !== admin.adminId) return NextResponse.json({ error: 'Not your action' }, { status: 403 })
  if (action.status !== 'proposed') {
    return NextResponse.json({ error: `Action already ${action.status}` }, { status: 400 })
  }

  await query(
    `UPDATE admin_agent_actions SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1
     WHERE id = $2::uuid`,
    [admin.adminId, params.id]
  )

  const { result, error } = await executeAction(action)

  await query(
    `UPDATE admin_agent_actions
     SET status = $1, executed_at = NOW(), result = $2::jsonb, error = $3
     WHERE id = $4::uuid`,
    [error ? 'failed' : 'executed', JSON.stringify(result || {}), error, params.id]
  )

  if (error) return NextResponse.json({ ok: false, error, status: 'failed' }, { status: 500 })
  return NextResponse.json({ ok: true, result, status: 'executed' })
}
