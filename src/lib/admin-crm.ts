import { queryOne, queryMany } from './db'

const fmtName = (fn: string | null, ln: string | null, email: string) =>
  [fn, ln].filter(Boolean).join(' ') || email

export async function getCrmDashboardData(adminId: string) {
  const [
    segmentCounts,
    crossingAtRisk,
    crossingDormant,
    recentTags,
    recentNotes,
    topTags,
    leadCount,
    recentSignups,
    taskCounts,
    healthDistribution,
    topChurnRisks,
    biggestDrops,
  ] = await Promise.all([
    queryOne<{
      total: string; vip: string; loyal: string; repeat: string; one_time: string;
      new: string; at_risk: string; dormant: string; b2b: string; lead: string;
    }>(`
      WITH agg AS (
        SELECT
          u.id,
          u.created_at,
          COALESCE(o.order_count, 0) AS order_count,
          COALESCE(o.paid_orders, 0) AS paid_orders,
          COALESCE(o.lifetime_value, 0) AS ltv,
          o.last_order_at,
          (cp.gst_number IS NOT NULL OR cp.company_name IS NOT NULL) AS is_b2b
        FROM users u
        LEFT JOIN customer_profiles cp ON cp.user_id = u.id
        LEFT JOIN (
          SELECT user_id,
                 COUNT(*) AS order_count,
                 COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
                 SUM(total_amount) AS lifetime_value,
                 MAX(created_at) AS last_order_at
          FROM orders GROUP BY user_id
        ) o ON o.user_id = u.id
        WHERE u.is_guest = false
      )
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ltv >= 50000) AS vip,
        COUNT(*) FILTER (WHERE paid_orders >= 5 AND ltv >= 25000) AS loyal,
        COUNT(*) FILTER (WHERE order_count >= 3) AS repeat,
        COUNT(*) FILTER (WHERE order_count = 1) AS one_time,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new,
        COUNT(*) FILTER (WHERE last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '90 days' AND last_order_at >= NOW() - INTERVAL '180 days') AS at_risk,
        COUNT(*) FILTER (WHERE last_order_at IS NOT NULL AND last_order_at < NOW() - INTERVAL '180 days') AS dormant,
        COUNT(*) FILTER (WHERE is_b2b) AS b2b,
        COUNT(*) FILTER (WHERE order_count = 0) AS lead
      FROM agg
    `, []),

    queryMany<{ id: string; first_name: string | null; last_name: string | null; email: string; last_order_at: string; ltv: string }>(`
      SELECT u.id, u.first_name, u.last_name, u.email,
             o.last_order_at, COALESCE(o.lifetime_value, 0) AS ltv
      FROM users u
      JOIN (
        SELECT user_id, MAX(created_at) AS last_order_at, SUM(total_amount) AS lifetime_value
        FROM orders GROUP BY user_id
      ) o ON o.user_id = u.id
      WHERE u.is_guest = false
        AND o.last_order_at < NOW() - INTERVAL '90 days'
        AND o.last_order_at >= NOW() - INTERVAL '97 days'
      ORDER BY o.lifetime_value DESC
      LIMIT 10
    `, []),

    queryMany<{ id: string; first_name: string | null; last_name: string | null; email: string; last_order_at: string; ltv: string }>(`
      SELECT u.id, u.first_name, u.last_name, u.email,
             o.last_order_at, COALESCE(o.lifetime_value, 0) AS ltv
      FROM users u
      JOIN (
        SELECT user_id, MAX(created_at) AS last_order_at, SUM(total_amount) AS lifetime_value
        FROM orders GROUP BY user_id
      ) o ON o.user_id = u.id
      WHERE u.is_guest = false
        AND o.last_order_at < NOW() - INTERVAL '180 days'
      ORDER BY o.lifetime_value DESC
      LIMIT 10
    `, []),

    queryMany<{ user_id: string; tag: string; created_at: string; first_name: string | null; last_name: string | null; email: string }>(`
      SELECT ct.user_id, ct.tag, ct.created_at, u.first_name, u.last_name, u.email
      FROM customer_tags ct
      JOIN users u ON u.id = ct.user_id
      ORDER BY ct.created_at DESC
      LIMIT 12
    `, []),

    queryMany<{ user_id: string; body: string; created_at: string; first_name: string | null; last_name: string | null; email: string; admin_first_name: string | null; admin_last_name: string | null }>(`
      SELECT cn.user_id, cn.body, cn.created_at,
             u.first_name, u.last_name, u.email,
             au.first_name AS admin_first_name, au.last_name AS admin_last_name
      FROM customer_notes cn
      JOIN users u ON u.id = cn.user_id
      LEFT JOIN admins a ON a.id = cn.admin_id
      LEFT JOIN users au ON au.id = a.user_id
      ORDER BY cn.created_at DESC
      LIMIT 8
    `, []),

    queryMany<{ tag: string; count: string }>(`
      SELECT tag, COUNT(*)::int AS count
      FROM customer_tags
      GROUP BY tag
      ORDER BY COUNT(*) DESC
      LIMIT 12
    `, []),

    queryOne<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.is_guest = false
        AND u.created_at >= NOW() - INTERVAL '7 days'
        AND o.id IS NULL
    `, []),

    queryMany<{ id: string; first_name: string | null; last_name: string | null; email: string; created_at: string }>(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.created_at
      FROM users u
      WHERE u.is_guest = false
      ORDER BY u.created_at DESC
      LIMIT 8
    `, []),

    queryOne<{ open_count: string; overdue_count: string; mine_count: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE ct.status IN ('pending', 'in_progress')) AS open_count,
        COUNT(*) FILTER (WHERE ct.status IN ('pending', 'in_progress') AND ct.due_date < CURRENT_DATE) AS overdue_count,
        COUNT(*) FILTER (WHERE ct.status IN ('pending', 'in_progress') AND ct.assigned_to = $1) AS mine_count
      FROM customer_tasks ct
    `, [adminId]),

    queryOne<{ b0_20: string; b20_40: string; b40_60: string; b60_80: string; b80_100: string; unscored: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE ch.score >= 0 AND ch.score < 20)   AS b0_20,
        COUNT(*) FILTER (WHERE ch.score >= 20 AND ch.score < 40)  AS b20_40,
        COUNT(*) FILTER (WHERE ch.score >= 40 AND ch.score < 60)  AS b40_60,
        COUNT(*) FILTER (WHERE ch.score >= 60 AND ch.score < 80)  AS b60_80,
        COUNT(*) FILTER (WHERE ch.score >= 80)                    AS b80_100,
        (SELECT COUNT(*) FROM users u
         LEFT JOIN customer_health ch2 ON ch2.user_id = u.id
         WHERE u.is_guest = false AND u.is_active = true AND ch2.user_id IS NULL) AS unscored
      FROM customer_health ch
      JOIN users u ON u.id = ch.user_id
      WHERE u.is_active = true AND u.is_guest = false
    `, []),

    queryMany<{ id: string; first_name: string | null; last_name: string | null; email: string; score: number; ltv: string; days_since_last_order: string | null }>(`
      SELECT u.id, u.first_name, u.last_name, u.email, ch.score,
             COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'), 0)::text AS ltv,
             EXTRACT(DAY FROM NOW() - (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid'))::int::text AS days_since_last_order
      FROM users u
      JOIN customer_health ch ON ch.user_id = u.id
      WHERE u.is_active = true AND u.is_guest = false
        AND ch.score < 40
      ORDER BY (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') DESC
      LIMIT 10
    `, []),

    queryMany<{ id: string; first_name: string | null; last_name: string | null; email: string; score: number; trend_delta_7d: number }>(`
      SELECT u.id, u.first_name, u.last_name, u.email, ch.score, ch.trend_delta_7d
      FROM users u
      JOIN customer_health ch ON ch.user_id = u.id
      WHERE u.is_active = true AND u.is_guest = false
        AND ch.trend_delta_7d <= -15
      ORDER BY ch.trend_delta_7d ASC
      LIMIT 5
    `, []),
  ])

  return {
    segments: {
      total:    parseInt(segmentCounts?.total ?? '0'),
      vip:      parseInt(segmentCounts?.vip ?? '0'),
      loyal:    parseInt(segmentCounts?.loyal ?? '0'),
      repeat:   parseInt(segmentCounts?.repeat ?? '0'),
      one_time: parseInt(segmentCounts?.one_time ?? '0'),
      new:      parseInt(segmentCounts?.new ?? '0'),
      at_risk:  parseInt(segmentCounts?.at_risk ?? '0'),
      dormant:  parseInt(segmentCounts?.dormant ?? '0'),
      b2b:      parseInt(segmentCounts?.b2b ?? '0'),
      lead:     parseInt(segmentCounts?.lead ?? '0'),
    },
    crossingAtRisk: crossingAtRisk.map(c => ({
      id: c.id,
      name: fmtName(c.first_name, c.last_name, c.email),
      email: c.email,
      lastOrderAt: c.last_order_at,
      ltv: parseFloat(c.ltv),
    })),
    crossingDormant: crossingDormant.map(c => ({
      id: c.id,
      name: fmtName(c.first_name, c.last_name, c.email),
      email: c.email,
      lastOrderAt: c.last_order_at,
      ltv: parseFloat(c.ltv),
    })),
    recentTags: recentTags.map(t => ({
      userId: t.user_id,
      name: fmtName(t.first_name, t.last_name, t.email),
      tag: t.tag,
      createdAt: t.created_at,
    })),
    recentNotes: recentNotes.map(n => ({
      userId: n.user_id,
      customerName: fmtName(n.first_name, n.last_name, n.email),
      adminName: [n.admin_first_name, n.admin_last_name].filter(Boolean).join(' ') || 'Admin',
      body: n.body,
      createdAt: n.created_at,
    })),
    topTags: topTags.map(t => ({ tag: t.tag, count: parseInt(t.count as unknown as string) })),
    leadsThisWeek: parseInt(leadCount?.count ?? '0'),
    recentSignups: recentSignups.map(s => ({
      id: s.id,
      name: fmtName(s.first_name, s.last_name, s.email),
      email: s.email,
      createdAt: s.created_at,
    })),
    tasks: {
      open:    parseInt(taskCounts?.open_count ?? '0'),
      overdue: parseInt(taskCounts?.overdue_count ?? '0'),
      mine:    parseInt(taskCounts?.mine_count ?? '0'),
    },
    health: {
      distribution: {
        b0_20:   parseInt(healthDistribution?.b0_20 ?? '0'),
        b20_40:  parseInt(healthDistribution?.b20_40 ?? '0'),
        b40_60:  parseInt(healthDistribution?.b40_60 ?? '0'),
        b60_80:  parseInt(healthDistribution?.b60_80 ?? '0'),
        b80_100: parseInt(healthDistribution?.b80_100 ?? '0'),
        unscored: parseInt(healthDistribution?.unscored ?? '0'),
      },
      topChurnRisks: topChurnRisks.map(c => ({
        id: c.id,
        name: fmtName(c.first_name, c.last_name, c.email),
        email: c.email,
        score: c.score,
        ltv: parseFloat(c.ltv),
        daysSinceLastOrder: c.days_since_last_order != null ? parseInt(c.days_since_last_order, 10) : null,
      })),
      biggestDrops: biggestDrops.map(c => ({
        id: c.id,
        name: fmtName(c.first_name, c.last_name, c.email),
        email: c.email,
        score: c.score,
        delta: c.trend_delta_7d,
      })),
    },
  }
}
