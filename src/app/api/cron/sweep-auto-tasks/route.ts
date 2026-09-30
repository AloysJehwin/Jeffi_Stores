import { NextRequest, NextResponse } from 'next/server'
import { query, queryMany } from '@/lib/db'
import { createAutoTask, type AutoTaskKind } from '@/lib/auto-tasks'

export const dynamic = 'force-dynamic'

interface SweepRow {
  user_id: string
  ref_id: string
  title: string
}

interface SweepRule {
  kind: AutoTaskKind
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueInDays: number
  description?: string
  query: string
}

const RULES: SweepRule[] = [
  {
    kind: 'process_confirmed',
    priority: 'medium',
    dueInDays: 0,
    description: 'Order confirmed >24h ago and not yet moved to processing.',
    query: `
      SELECT o.user_id, o.id::text AS ref_id,
             'Process confirmed order #' || o.order_number AS title
      FROM orders o
      WHERE o.status = 'confirmed'
        AND o.user_id IS NOT NULL
        AND o.updated_at < NOW() - INTERVAL '24 hours'
    `,
  },
  {
    kind: 'stuck_processing',
    priority: 'high',
    dueInDays: 0,
    description: 'Order has been in "processing" for over 3 days.',
    query: `
      SELECT o.user_id, o.id::text AS ref_id,
             'Order #' || o.order_number || ' stuck in processing' AS title
      FROM orders o
      WHERE o.status = 'processing'
        AND o.user_id IS NOT NULL
        AND o.updated_at < NOW() - INTERVAL '3 days'
    `,
  },
  {
    kind: 'stuck_shipment',
    priority: 'high',
    dueInDays: 0,
    description: 'Order has been "dispatched/shipped" for >7 days with no fresh Delhivery update.',
    query: `
      SELECT o.user_id, o.id::text AS ref_id,
             'Shipment #' || o.order_number || ' not moving' AS title
      FROM orders o
      WHERE o.status IN ('dispatched', 'shipped')
        AND o.user_id IS NOT NULL
        AND o.shipped_at < NOW() - INTERVAL '7 days'
        AND o.updated_at < NOW() - INTERVAL '24 hours'
    `,
  },
  {
    kind: 'ndr_check',
    priority: 'medium',
    dueInDays: 0,
    description: 'Order has been "out for delivery" for over 2 days — likely NDR.',
    query: `
      SELECT o.user_id, o.id::text AS ref_id,
             'Check delivery status #' || o.order_number AS title
      FROM orders o
      WHERE o.status = 'out_for_delivery'
        AND o.user_id IS NOT NULL
        AND o.updated_at < NOW() - INTERVAL '2 days'
    `,
  },
  {
    kind: 'chase_refund',
    priority: 'high',
    dueInDays: 0,
    description: 'Refund initiated >7 days ago and still pending.',
    query: `
      SELECT o.user_id, o.id::text AS ref_id,
             'Chase refund for #' || o.order_number AS title
      FROM orders o
      WHERE o.payment_status = 'pending'
        AND o.status IN ('cancelled', 'returned', 'return_received')
        AND o.user_id IS NOT NULL
        AND o.updated_at < NOW() - INTERVAL '7 days'
    `,
  },
  {
    kind: 'b2b_welcome',
    priority: 'medium',
    dueInDays: 2,
    description: 'New B2B customer — welcome call.',
    query: `
      SELECT u.id AS user_id, u.id::text AS ref_id,
             'Welcome call for new B2B account' AS title
      FROM users u
      JOIN customer_profiles cp ON cp.user_id = u.id
      WHERE cp.customer_type = 'b2b'
        AND u.is_guest = false
        AND u.is_active = true
        AND u.created_at > NOW() - INTERVAL '7 days'
    `,
  },
  {
    kind: 'collect_gst',
    priority: 'medium',
    dueInDays: 3,
    description: 'B2B customer registered without GST number.',
    query: `
      SELECT u.id AS user_id, u.id::text AS ref_id,
             'Collect GST number from B2B customer' AS title
      FROM users u
      JOIN customer_profiles cp ON cp.user_id = u.id
      WHERE cp.customer_type = 'b2b'
        AND u.is_guest = false
        AND u.is_active = true
        AND (cp.gst_number IS NULL OR cp.gst_number = '')
        AND u.created_at < NOW() - INTERVAL '2 days'
        AND u.created_at > NOW() - INTERVAL '30 days'
    `,
  },
  {
    kind: 'vip_check_in',
    priority: 'medium',
    dueInDays: 3,
    description: "VIP customer (>₹50k LTV) hasn't ordered in 60+ days.",
    query: `
      SELECT u.id AS user_id, u.id::text AS ref_id,
             'Check in with VIP customer' AS title
      FROM users u
      WHERE u.is_guest = false
        AND u.is_active = true
        AND (
          SELECT COALESCE(SUM(o.total_amount), 0)
          FROM orders o
          WHERE o.user_id = u.id AND o.payment_status = 'paid'
        ) >= 50000
        AND (
          SELECT MAX(o.created_at) FROM orders o
          WHERE o.user_id = u.id AND o.payment_status = 'paid'
        ) < NOW() - INTERVAL '60 days'
    `,
  },
  {
    kind: 'winback',
    priority: 'medium',
    dueInDays: 3,
    description: 'At-risk customer about to cross into dormant (last order ~180 days ago).',
    query: `
      SELECT u.id AS user_id, u.id::text AS ref_id,
             'Win-back outreach for ' || COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '') AS title
      FROM users u
      WHERE u.is_guest = false
        AND u.is_active = true
        AND (
          SELECT MAX(o.created_at) FROM orders o
          WHERE o.user_id = u.id AND o.payment_status = 'paid'
        ) BETWEEN NOW() - INTERVAL '180 days' AND NOW() - INTERVAL '160 days'
    `,
  },
  {
    kind: 'lead_followup',
    priority: 'low',
    dueInDays: 2,
    description: 'Signed up >14 days ago, never placed an order.',
    query: `
      SELECT u.id AS user_id, u.id::text AS ref_id,
             'Follow up with lead — no order yet' AS title
      FROM users u
      WHERE u.is_guest = false
        AND u.is_active = true
        AND u.created_at < NOW() - INTERVAL '14 days'
        AND u.created_at > NOW() - INTERVAL '60 days'
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
    `,
  },
  {
    kind: 'support_pickup',
    priority: 'urgent',
    dueInDays: 0,
    description: 'Customer support session opened with no admin reply yet.',
    query: `
      SELECT ss.user_id, ss.id::text AS ref_id,
             'Pick up support session' AS title
      FROM support_sessions ss
      WHERE ss.status = 'open'
        AND ss.admin_name IS NULL
        AND ss.created_at < NOW() - INTERVAL '15 minutes'
        AND ss.user_id IS NOT NULL
    `,
  },
  {
    kind: 'support_urgent',
    priority: 'urgent',
    dueInDays: 0,
    description: 'Open support session with no admin reply for >2 hours.',
    query: `
      SELECT ss.user_id, ss.id::text AS ref_id,
             'Urgent: respond to support session' AS title
      FROM support_sessions ss
      WHERE ss.status = 'open'
        AND ss.user_id IS NOT NULL
        AND COALESCE(
          (SELECT MAX(sm.created_at) FROM support_messages sm
           WHERE sm.session_id = ss.id AND sm.sender = 'admin'),
          ss.created_at
        ) < NOW() - INTERVAL '2 hours'
    `,
  },
  {
    kind: 'login_anomaly',
    priority: 'urgent',
    dueInDays: 0,
    description: 'More than 5 failed login attempts in the last hour.',
    query: `
      SELECT fla.user_id, fla.user_id::text AS ref_id,
             'Possible account compromise — investigate' AS title
      FROM failed_login_attempts fla
      WHERE fla.user_id IS NOT NULL
        AND fla.created_at > NOW() - INTERVAL '1 hour'
      GROUP BY fla.user_id
      HAVING COUNT(*) >= 5
    `,
  },
]

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Auto-deactivate products whose discontinue_date has passed
  const deactivated = await query(
    `UPDATE products SET is_active = false
     WHERE discontinue_date IS NOT NULL
       AND discontinue_date <= CURRENT_DATE
       AND is_active = true`
  )
  const deactivatedCount = deactivated.rowCount ?? 0

  const created: Record<string, number> = {}
  const errors: string[] = []

  for (const rule of RULES) {
    try {
      const rows = await queryMany<SweepRow>(rule.query)
      let count = 0
      for (const row of rows) {
        const id = await createAutoTask({
          userId: row.user_id,
          sourceKind: rule.kind,
          sourceRefId: row.ref_id,
          title: row.title,
          description: rule.description,
          priority: rule.priority,
          dueInDays: rule.dueInDays,
        })
        if (id) count++
      }
      created[rule.kind] = count
    } catch (err: any) {
      errors.push(`${rule.kind}: ${err.message}`)
    }
  }

  return NextResponse.json({
    success: true,
    deactivatedProducts: deactivatedCount,
    created,
    totalCreated: Object.values(created).reduce((a, b) => a + b, 0),
    errors: errors.length > 0 ? errors : undefined,
  })
}
