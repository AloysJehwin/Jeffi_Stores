import { NextRequest, NextResponse } from 'next/server'
import { authenticateAnyUser } from '@/lib/jwt'
import { query, queryOne, queryMany } from '@/lib/db'
import { sendSupportEscalationEmail } from '@/lib/email'
import { logActivity } from '@/lib/activity'
import { getCurrentTenant } from '@/lib/tenant-context'
import { getTenantOwners } from '@/lib/tenant-registry'
import { createAdminNotification } from '@/lib/admin-notify'
import { z } from 'zod'
import { parseBody, zUuid } from '@/lib/validate'

const postSchema = z.object({
  productId: zUuid.nullish(),
})

/**
 * Who a support escalation should reach. On a tenant host the request belongs to that store, so
 * it must go to the store's own owner(s) only — never the platform's admins or ADMIN_EMAIL, which
 * previously fanned every tenant's support request out to the platform team. Off-tenant (the
 * platform's own store) keeps the platform-admin + ADMIN_EMAIL behaviour.
 */
async function resolveEscalationRecipients(tenantId: string | null): Promise<string[]> {
  if (tenantId) {
    const owners = await getTenantOwners(tenantId).catch(() => [])
    return owners.map(o => o.email).filter((e): e is string => !!e)
  }
  const admins = await queryMany(
    `SELECT u.email FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = true AND u.email IS NOT NULL`,
    []
  )
  const emails = admins.map((a: any) => a.email)
  const fallback = process.env.ADMIN_EMAIL
  if (fallback && !emails.includes(fallback)) emails.push(fallback)
  return emails
}

export async function GET(request: NextRequest) {
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const session = await queryOne(
      `SELECT id, status, created_at, admin_name FROM support_sessions
       WHERE user_id = $1 AND status = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [authUser.userId]
    )

    return NextResponse.json({ session: session || null })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateAnyUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const raw = await request.json().catch(() => ({}))
    const parsed = parseBody(postSchema, raw, 'POST /api/support/sessions')
    if (!parsed.ok) return parsed.response

    const existing = await queryOne(
      `SELECT id, status, created_at FROM support_sessions WHERE user_id = $1 AND status = 'open' LIMIT 1`,
      [authUser.userId]
    )
    if (existing) {
      return NextResponse.json({ session: existing })
    }

    const tenant = getCurrentTenant()

    const session = await queryOne(
      `INSERT INTO support_sessions (user_id, tenant_id) VALUES ($1, $2) RETURNING id, status, created_at`,
      [authUser.userId, tenant?.tenantId ?? null]
    )

    logActivity({
      userId: authUser.userId,
      kind: 'support_session_started',
      referenceId: session.id,
      referenceType: 'support_sessions',
      summary: 'Started a support chat',
    }).catch(() => {})

    const user = await queryOne(
      `SELECT first_name, last_name, email FROM users WHERE id = $1`,
      [authUser.userId]
    )

    if (user) {
      const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Customer'
      const recipients = await resolveEscalationRecipients(tenant?.tenantId ?? null)
      if (recipients.length > 0) {
        await sendSupportEscalationEmail(name, user.email, authUser.userId, session.id, recipients)
      }

      createAdminNotification({
        type: 'support_escalation',
        category: 'support',
        title: `Support chat — ${name}`,
        message: user.email || null,
        link: `/admin/customers/${authUser.userId}`,
        entityType: 'support_session',
        entityId: String(session.id),
        severity: 'warning',
        scope: 'customers:read',
      }).catch(() => {})
    }

    return NextResponse.json({ session })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to create session' }, { status: 500 })
  }
}
