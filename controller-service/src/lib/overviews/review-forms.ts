import type { AttentionItem } from '@/lib/overview/attention'
import { ratio } from '@/lib/overview/period'
import { BOUNDS, num, periodCase, str } from './marketing'

// Review incentive forms. "Requests" are review-form-share broadcast messages (email_campaign_logs
// for email_campaigns with template_key 'review_form_share') sent in the period.

// Each takes the list's filters as conditions on its form-id column; '' keeps the SQL unchanged.
export const kpiSql = (forms = '') => `
WITH ${BOUNDS},
s AS (
  SELECT rs.*, ${periodCase('rs.submitted_at')} AS period
    FROM review_form_submissions rs, b
   WHERE rs.submitted_at >= b.p0 AND rs.submitted_at < b.c1${forms}
),
r AS (
  SELECT ${periodCase('l.sent_at')} AS period, l.status
    FROM email_campaign_logs l JOIN email_campaigns c ON c.id = l.campaign_id, b
   WHERE c.template_key = 'review_form_share' AND l.sent_at >= b.p0 AND l.sent_at < b.c1
)
SELECT p.period,
       (SELECT COUNT(*) FROM s WHERE s.period = p.period) AS submissions,
       (SELECT COUNT(*) FROM s WHERE s.period = p.period AND s.status = 'approved') AS approved,
       (SELECT COUNT(*) FROM s WHERE s.period = p.period AND s.status = 'rejected') AS rejected,
       (SELECT COUNT(*) FROM s WHERE s.period = p.period AND s.status = 'pending') AS pending,
       (SELECT COUNT(*) FROM s WHERE s.period = p.period AND s.coupon_code IS NOT NULL) AS coupons,
       (SELECT COUNT(*) FROM r WHERE r.period = p.period AND r.status <> 'failed') AS requests
  FROM (VALUES ('cur'), ('prev')) p(period)
`
export const KPI_SQL = kpiSql()

export const formsSql = (forms = '') => `
WITH ${BOUNDS}
SELECT f.id, f.title, f.slug, f.is_active, c.code AS coupon_code, f.submissions_count AS all_time,
       COUNT(rs.id) AS submissions,
       COUNT(rs.id) FILTER (WHERE rs.status = 'pending') AS pending,
       COUNT(rs.id) FILTER (WHERE rs.status = 'approved') AS approved
  FROM review_forms f
  LEFT JOIN coupons c ON c.id = f.coupon_id
  CROSS JOIN b
  LEFT JOIN review_form_submissions rs ON rs.form_id = f.id AND rs.submitted_at >= b.c0 AND rs.submitted_at < b.c1
 WHERE NOT f.is_draft${forms}
 GROUP BY f.id, c.code
 ORDER BY submissions DESC, f.created_at DESC LIMIT 20
`
export const FORMS_SQL = formsSql()

export const stateSql = (f = '', s = '') => `
SELECT (SELECT COUNT(*) FROM review_forms WHERE NOT is_draft${f}) AS forms,
       (SELECT COUNT(*) FROM review_forms WHERE NOT is_draft AND is_active${f}) AS active,
       (SELECT COUNT(*) FROM review_forms WHERE NOT is_draft AND is_active AND coupon_id IS NULL${f}) AS no_coupon,
       (SELECT COUNT(*) FROM review_form_submissions WHERE status = 'pending'${s}) AS pending,
       (SELECT MIN(submitted_at) FROM review_form_submissions WHERE status = 'pending'${s}) AS oldest_pending
`
export const STATE_SQL = stateSql()

export interface ReviewFormTotals {
  submissions: number
  approved: number
  rejected: number
  pending: number
  coupons: number
  requests: number
  conversion: number | null
  approval_rate: number | null
}

export function toReviewFormTotals(r: Record<string, unknown> | undefined): ReviewFormTotals {
  const t = {
    submissions: num(r?.submissions),
    approved: num(r?.approved),
    rejected: num(r?.rejected),
    pending: num(r?.pending),
    coupons: num(r?.coupons),
    requests: num(r?.requests),
  }
  return {
    ...t,
    conversion: ratio(t.submissions, t.requests),
    approval_rate: ratio(t.approved, t.approved + t.rejected),
  }
}

export const toFormRow = (r: Record<string, unknown>) => ({
  id: str(r.id),
  title: str(r.title),
  slug: str(r.slug),
  active: !!r.is_active,
  coupon_code: r.coupon_code ? str(r.coupon_code) : null,
  all_time: num(r.all_time),
  submissions: num(r.submissions),
  pending: num(r.pending),
  approved: num(r.approved),
})

export interface ReviewFormState {
  forms: number
  active: number
  no_coupon: number
  pending: number
  oldest_pending: unknown
}

export const toReviewFormState = (r: Record<string, unknown> | undefined): ReviewFormState => ({
  forms: num(r?.forms),
  active: num(r?.active),
  no_coupon: num(r?.no_coupon),
  pending: num(r?.pending),
  oldest_pending: r?.oldest_pending ?? null,
})

const DAY = 86_400_000

export function reviewFormAttention(
  state: ReviewFormState,
  forms: ReturnType<typeof toFormRow>[],
  now = Date.now()
): AttentionItem[] {
  const out: AttentionItem[] = []
  if (state.pending) {
    const age = state.oldest_pending ? Math.floor((now - new Date(String(state.oldest_pending)).getTime()) / DAY) : 0
    const top = forms.filter(f => f.pending).sort((a, b) => b.pending - a.pending)[0]
    out.push({
      key: 'pending',
      severity: age >= 3 ? 'warning' : 'info',
      title: `${state.pending} submission${state.pending === 1 ? '' : 's'} waiting for review`,
      sub:
        age >= 1
          ? `Oldest is ${age} day${age === 1 ? '' : 's'} old; customers are waiting for their coupon.`
          : undefined,
      href: top ? `/admin/review-forms/${top.id}/submissions` : '/admin/review-forms?tab=list',
    })
  }
  if (state.no_coupon)
    out.push({
      key: 'no_coupon',
      severity: 'info',
      title: `${state.no_coupon} active form${state.no_coupon === 1 ? ' has' : 's have'} no reward coupon`,
      href: '/admin/review-forms?tab=list',
    })
  const idle = forms.filter(f => f.active && f.submissions === 0)
  if (idle.length && state.active > 0)
    out.push({
      key: 'idle',
      severity: 'info',
      title: `${idle.length} active form${idle.length === 1 ? '' : 's'} got no submissions this period`,
      sub: 'Share the form link in a message to recent buyers.',
      href: '/admin/marketing/messaging/new',
    })
  return out
}
