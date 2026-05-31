import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany, queryOne } from '@/lib/db'
import { sendTestCampaignEmail } from '@/lib/automation-emails'
import { sendOrderDelayNotification, sendProductAnnouncementEmail } from '@/lib/email'
import { VARIANT_MIN_PRICE_SQL } from '@/lib/queries'
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

async function executeAction(action: AgentAction, cookieHeader: string): Promise<{ result: any; error: string | null }> {
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
    case 'send_order_delay_email': {
      const { customerEmail, customerName, orderNumber, delayDays, reason } = action.payload
      if (!customerEmail || !orderNumber || !delayDays || !reason) {
        return { result: null, error: 'Missing required fields in payload' }
      }
      const r = await sendOrderDelayNotification({
        toEmail: customerEmail,
        customerName: customerName || 'there',
        orderNumber,
        delayDays: Number(delayDays),
        reason: String(reason),
      })
      if (!r.success) return { result: null, error: 'Send failed' }
      return { result: { sentTo: customerEmail, orderNumber, delayDays, messageId: r.messageId }, error: null }
    }
    case 'send_product_announcement_email': {
      const { productIds, audience, testEmail, subject, intro } = action.payload as {
        productIds: string[]; audience: string; testEmail: string | null; subject: string; intro: string
      }
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return { result: null, error: 'productIds missing' }
      }
      const products = await queryMany<{
        id: string; name: string; slug: string; price: string; short_description: string | null; primary_image_url: string | null
      }>(
        `SELECT p.id::text, p.name, p.slug,
                COALESCE(NULLIF(${VARIANT_MIN_PRICE_SQL}, 0), p.base_price)::text AS price,
                p.short_description,
                (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY display_order ASC LIMIT 1) AS primary_image_url
           FROM products p WHERE p.id = ANY($1::uuid[]) AND p.is_active = TRUE`,
        [productIds]
      )
      if (products.length === 0) return { result: null, error: 'No active products resolved' }

      let recipients: { email: string; name: string }[] = []
      if (audience === 'test_only') {
        if (!testEmail) return { result: null, error: 'testEmail missing' }
        recipients = [{ email: testEmail, name: 'there' }]
      } else if (audience === 'all_opted_in') {
        recipients = await queryMany(
          `SELECT email, COALESCE(NULLIF(TRIM(first_name || ' ' || COALESCE(last_name,'')), ''), email) AS name
             FROM users WHERE email IS NOT NULL AND marketing_opt_out IS NOT TRUE`
        ) as any
      } else if (audience === 'recent_buyers') {
        recipients = await queryMany(
          `SELECT DISTINCT u.email, COALESCE(NULLIF(TRIM(u.first_name || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS name
             FROM users u JOIN orders o ON o.user_id = u.id
            WHERE u.email IS NOT NULL AND u.marketing_opt_out IS NOT TRUE
              AND o.created_at > NOW() - INTERVAL '90 days'`
        ) as any
      } else {
        return { result: null, error: `Unknown audience: ${audience}` }
      }

      let sent = 0, failed = 0
      for (const r of recipients) {
        const out = await sendProductAnnouncementEmail({
          toEmail: r.email, customerName: r.name, subject, intro, products,
        })
        if (out.success) sent++; else failed++
      }
      return {
        result: { audience, recipients: recipients.length, sent, failed, productCount: products.length },
        error: failed > 0 && sent === 0 ? `All ${failed} sends failed` : null,
      }
    }
    case 'register_dynamic_tool': {
      const { name, description, dynamicKind, argsSchema, sqlTemplate, emailTemplate, sourcePrompt } = action.payload
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO admin_agent_proposed_tools
           (proposed_by_admin_id, source_prompt, name, description, args_schema, kind,
            sql_template, email_template, status)
         VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, 'proposed')
         ON CONFLICT (name) WHERE status = 'approved' DO NOTHING
         RETURNING id::text`,
        [
          action.admin_id,
          sourcePrompt,
          name,
          description,
          JSON.stringify(argsSchema || {}),
          dynamicKind,
          sqlTemplate || null,
          emailTemplate ? JSON.stringify(emailTemplate) : null,
        ]
      )
      if (!inserted) return { result: null, error: 'A tool with this name is already approved' }
      return {
        result: { proposedToolId: inserted.id, name, kind: dynamicKind, reviewUrl: `/admin/agent/proposed-tools` },
        error: null,
      }
    }
    case 'send_dynamic_email': {
      const { toolId, toolName, toEmail, subject, body } = action.payload as {
        toolId: string; toolName: string; toEmail: string; subject: string; body: string
      }
      if (!toEmail || !subject || !body) {
        return { result: null, error: 'Missing required fields' }
      }
      const { transporter } = await import('@/lib/email')
      try {
        const info = await transporter.sendMail({
          from: `"Jeffi Store's" <${process.env.SES_FROM_EMAIL}>`,
          to: toEmail,
          subject,
          text: body,
        })
        await query(
          `UPDATE admin_agent_proposed_tools
              SET invocation_count = invocation_count + 1, last_invoked_at = NOW()
            WHERE id = $1::uuid`,
          [toolId]
        )
        return { result: { sentTo: toEmail, toolName, messageId: info.messageId }, error: null }
      } catch (err: any) {
        return { result: null, error: String(err?.message || 'Send failed') }
      }
    }
    case 'call_admin_api': {
      const { method, path, body } = action.payload as { method: string; path: string; body: string | null }
      const FORBIDDEN_PATH_RE = /^\/api\/admin\/(agent\/|team\b|admins\b|auth\b|settings\/admins)/
      if (!path?.startsWith('/api/admin/') || FORBIDDEN_PATH_RE.test(path)) {
        return { result: null, error: 'Path not permitted at execution time' }
      }
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return { result: null, error: 'Method not permitted at execution time' }
      }
      const origin = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${process.env.PORT || 3000}`
      const url = new URL(path, origin).toString()
      try {
        const res = await fetch(url, {
          method,
          headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
          body: body || undefined,
        })
        let parsed: unknown
        try { parsed = await res.json() } catch { parsed = await res.text().catch(() => null) }
        return {
          result: { method, path, status: res.status, ok: res.ok, body: parsed },
          error: res.ok ? null : `Upstream returned ${res.status}`,
        }
      } catch (err: any) {
        return { result: null, error: String(err?.message || 'API call failed') }
      }
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

  const cookieHeader = req.headers.get('cookie') || ''
  const { result, error } = await executeAction(action, cookieHeader)

  await query(
    `UPDATE admin_agent_actions
     SET status = $1, executed_at = NOW(), result = $2::jsonb, error = $3
     WHERE id = $4::uuid`,
    [error ? 'failed' : 'executed', JSON.stringify(result || {}), error, params.id]
  )

  if (error) return NextResponse.json({ ok: false, error, status: 'failed' }, { status: 500 })
  return NextResponse.json({ ok: true, result, status: 'executed' })
}
